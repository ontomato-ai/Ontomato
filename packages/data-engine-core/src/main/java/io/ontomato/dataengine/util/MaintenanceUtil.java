package io.ontomato.dataengine.util;

import java.io.*;
import java.lang.management.ManagementFactory;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.alibaba.fastjson2.*;
import com.sun.management.OperatingSystemMXBean;

/**
 * System monitoring class: collects the resources visible to this process (CPU, memory, disk) and the status of the
 * data engine's own Java process, aggregated into JSON. Read-only: it never starts, stops or restarts anything.
 */
public class MaintenanceUtil {

        /** Used to parse the CPU usage (us/sy/id/wa) from the Linux top command output */
        private static final Pattern CPU_PATTERN = Pattern.compile(
                "(\\d+\\.?\\d*)\\s*us.*?(\\d+\\.?\\d*)\\s*sy.*?(\\d+\\.?\\d*)\\s*id.*?(\\d+\\.?\\d*)\\s*wa");
        /** Used to parse the macOS top output, which has no wait time: "CPU usage: 21.3% user, 6.1% sys, 72.4% idle" */
        private static final Pattern MAC_CPU_PATTERN = Pattern.compile(
                "(\\d+\\.?\\d*)%\\s*user,\\s*(\\d+\\.?\\d*)%\\s*sys,\\s*(\\d+\\.?\\d*)%\\s*idle");
        /** Used to parse the page size from the macOS vm_stat header */
        private static final Pattern VM_PAGE_SIZE_PATTERN = Pattern.compile("page size of (\\d+) bytes");
        /** Used to parse one "Pages xxx: 123." counter of the macOS vm_stat output */
        private static final Pattern VM_PAGE_COUNT_PATTERN = Pattern.compile("^Pages ([^:]+):\\s*(\\d+)\\.");
        /** Used to parse the process running time format (dd-HH:MM:SS) */
        private static final Pattern ETIME_PATTERN = Pattern.compile(
                "(?:(\\d+)-)?(?:(\\d{2}):)?(\\d{2}):(\\d{2})");

        /**
         * Collects all monitoring information
         * @return JSON object containing all monitoring data
         */
        public JSONObject collectAll() {
            JSONObject result = new JSONObject();
            result.put("timestamp",
                    ZonedDateTime.now()
                            .format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX")));
            result.put("hostname", getHostname());
            result.put("server", getHostInfo());
            result.put("backend", getBackendInfo());
            return result;
        }

        // ======================== 1. Host information ========================

        /**
         * Gets host information, including CPU, memory and disk
         * @return JSON object containing the host information
         */
        public JSONObject getHostInfo() {
            JSONObject server = new JSONObject();
            server.put("cpu", getCpuInfo());
            server.put("memory", getMemoryInfo());
            server.put("disk", getDiskInfo());
            return server;
        }

        /**
         * Gets CPU usage information. Linux is read from top, macOS from top's CPU usage line and, when
         * neither command is available (for example a slim container image), from the JVM's own view of
         * the host.
         * @return JSON object containing user/system/idle/wait and the usage rate
         */
        private JSONObject getCpuInfo() {
            JSONObject cpu = new JSONObject();
            cpu.put("system", 0);
            cpu.put("user", 0);
            cpu.put("idle", 100.0);
            cpu.put("wait", 0);
            cpu.put("userate", 0);
            boolean parsed = isMac() ? parseMacCpu(cpu) : parseLinuxCpu(cpu);
            if (!parsed) {
                applyJvmCpuLoad(cpu);
            }
            return cpu;
        }

        /**
         * Parses the CPU line of the Linux top command.
         * @param cpu JSON object to fill
         * @return true when the output was parsed
         */
        private boolean parseLinuxCpu(JSONObject cpu) {
            try {
                String output = runCommand("bash", "-c",
                        "LC_ALL=C top -bn2 -d 1 2>/dev/null | grep '%Cpu' | tail -1");
                if (output != null && !output.isEmpty()) {
                    Matcher m = CPU_PATTERN.matcher(output);
                    if (m.find()) {
                        double us = Double.parseDouble(m.group(1));
                        double sy = Double.parseDouble(m.group(2));
                        double id = Double.parseDouble(m.group(3));
                        double wa = Double.parseDouble(m.group(4));
                        cpu.put("user", us);
                        cpu.put("system", sy);
                        cpu.put("idle", id);
                        cpu.put("wait", wa);
                        cpu.put("userate", Math.round((100.0 - id) * 10.0) / 10.0);
                        return true;
                    }
                }
            } catch (Exception e) {
                // fall through to the JVM view
            }
            return false;
        }

        /**
         * Parses the CPU line of the macOS top command. macOS reports no wait time, so it stays 0.
         * @param cpu JSON object to fill
         * @return true when the output was parsed
         */
        private boolean parseMacCpu(JSONObject cpu) {
            try {
                String output = runCommand("bash", "-c",
                        "LC_ALL=C top -l 2 -n 0 2>/dev/null | grep 'CPU usage' | tail -1");
                if (output != null && !output.isEmpty()) {
                    Matcher m = MAC_CPU_PATTERN.matcher(output);
                    if (m.find()) {
                        double us = Double.parseDouble(m.group(1));
                        double sy = Double.parseDouble(m.group(2));
                        double id = Double.parseDouble(m.group(3));
                        cpu.put("user", us);
                        cpu.put("system", sy);
                        cpu.put("idle", id);
                        cpu.put("wait", 0);
                        cpu.put("userate", Math.round((100.0 - id) * 10.0) / 10.0);
                        return true;
                    }
                }
            } catch (Exception e) {
                // fall through to the JVM view
            }
            return false;
        }

        /**
         * Uses the JVM's host CPU load when the platform commands are unavailable.
         * @param cpu JSON object to fill
         */
        private void applyJvmCpuLoad(JSONObject cpu) {
            try {
                double load = ManagementFactory.getPlatformMXBean(OperatingSystemMXBean.class).getCpuLoad();
                if (load >= 0) {
                    double userate = Math.round(load * 1000.0) / 10.0;
                    cpu.put("user", userate);
                    cpu.put("system", 0);
                    cpu.put("idle", Math.round((100.0 - userate) * 10.0) / 10.0);
                    cpu.put("wait", 0);
                    cpu.put("userate", userate);
                }
            } catch (Exception e) {
                // keep defaults
            }
        }

        /**
         * Gets memory usage information. Linux is read from free, macOS from vm_stat and sysctl and, when
         * neither command is available, from the JVM's own view of the host.
         * @return JSON object containing total_gb/used_gb/free_gb/usage_percent
         */
        private JSONObject getMemoryInfo() {
            JSONObject memory = new JSONObject();
            memory.put("total_gb", 0);
            memory.put("used_gb", 0);
            memory.put("free_gb", 0);
            memory.put("usage_percent", 0);
            boolean parsed = isMac() ? parseMacMemory(memory) : parseLinuxMemory(memory);
            if (!parsed) {
                applyJvmMemory(memory);
            }
            return memory;
        }

        /**
         * Parses the memory line of the Linux free command.
         * @param memory JSON object to fill
         * @return true when the output was parsed
         */
        private boolean parseLinuxMemory(JSONObject memory) {
            try {
                String output = runCommand("bash", "-c",
                        "LC_ALL=C free -g 2>/dev/null | grep '^Mem:' | head -1");
                if (output != null && !output.isEmpty()) {
                    String[] parts = output.trim().split("\\s+");
                    if (parts.length >= 4) {
                        double total = Double.parseDouble(parts[1]);
                        double used = Double.parseDouble(parts[2]);
                        double free = Double.parseDouble(parts[3]);
                        putMemory(memory, total, used, free);
                        return true;
                    }
                }
            } catch (Exception e) {
                // fall through to the JVM view
            }
            return false;
        }

        /**
         * Reads the macOS physical memory from vm_stat and sysctl. Used memory is the sum of active,
         * wired and compressed pages, matching the value Activity Monitor reports as "Memory Used".
         * @param memory JSON object to fill
         * @return true when the output was parsed
         */
        private boolean parseMacMemory(JSONObject memory) {
            try {
                String totalOutput = runCommand("sysctl", "-n", "hw.memsize");
                String vmOutput = runCommand("vm_stat");
                if (totalOutput == null || totalOutput.trim().isEmpty() || vmOutput == null
                        || vmOutput.isEmpty()) {
                    return false;
                }
                long totalBytes = Long.parseLong(totalOutput.trim());
                Matcher pageSizeMatcher = VM_PAGE_SIZE_PATTERN.matcher(vmOutput);
                if (totalBytes <= 0 || !pageSizeMatcher.find()) {
                    return false;
                }
                long pageSize = Long.parseLong(pageSizeMatcher.group(1));
                long activePages = 0;
                long wiredPages = 0;
                long compressedPages = 0;
                for (String line : vmOutput.split("\n")) {
                    Matcher m = VM_PAGE_COUNT_PATTERN.matcher(line.trim());
                    if (!m.find()) {
                        continue;
                    }
                    String counter = m.group(1).trim();
                    long pages = Long.parseLong(m.group(2));
                    if ("active".equalsIgnoreCase(counter)) {
                        activePages = pages;
                    } else if ("wired down".equalsIgnoreCase(counter)) {
                        wiredPages = pages;
                    } else if ("occupied by compressor".equalsIgnoreCase(counter)) {
                        compressedPages = pages;
                    }
                }
                long usedBytes = (activePages + wiredPages + compressedPages) * pageSize;
                if (usedBytes <= 0 || usedBytes > totalBytes) {
                    usedBytes = Math.max(0, totalBytes - freeBytesFromJvm());
                }
                long freeBytes = Math.max(0, totalBytes - usedBytes);
                double totalGb = Math.round(bytesToGb(totalBytes) * 100.0) / 100.0;
                double usedGb = Math.round(bytesToGb(usedBytes) * 100.0) / 100.0;
                double freeGb = Math.round(bytesToGb(freeBytes) * 100.0) / 100.0;
                putMemory(memory, totalGb, usedGb, freeGb);
                return true;
            } catch (Exception e) {
                // fall through to the JVM view
            }
            return false;
        }

        /**
         * Uses the JVM's host memory sizes when the platform commands are unavailable.
         * @param memory JSON object to fill
         */
        private void applyJvmMemory(JSONObject memory) {
            try {
                OperatingSystemMXBean os = ManagementFactory.getPlatformMXBean(OperatingSystemMXBean.class);
                long totalBytes = os.getTotalMemorySize();
                long freeBytes = os.getFreeMemorySize();
                if (totalBytes > 0) {
                    long usedBytes = Math.max(0, totalBytes - Math.max(0, freeBytes));
                    putMemory(memory, bytesToGb(totalBytes), bytesToGb(usedBytes), bytesToGb(freeBytes));
                }
            } catch (Exception e) {
                // keep defaults
            }
        }

        /**
         * Stores the memory sizes rounded to two decimals and derives the usage percentage.
         * @param memory JSON object to fill
         * @param totalGb total memory in GB
         * @param usedGb used memory in GB
         * @param freeGb free memory in GB
         */
        private void putMemory(JSONObject memory, double totalGb, double usedGb, double freeGb) {
            memory.put("total_gb", Math.round(totalGb * 100.0) / 100.0);
            memory.put("used_gb", Math.round(usedGb * 100.0) / 100.0);
            memory.put("free_gb", Math.max(0, Math.round(freeGb * 100.0) / 100.0));
            memory.put("usage_percent", totalGb > 0
                    ? Math.round(usedGb / totalGb * 1000.0) / 10.0
                    : 0);
        }

        /**
         * Converts bytes to gigabytes.
         * @param bytes byte count
         * @return the value in GB
         */
        private double bytesToGb(long bytes) {
            return bytes / 1024.0 / 1024.0 / 1024.0;
        }

        /**
         * Reads the JVM-visible free memory, used only to keep the macOS split consistent.
         * @return free bytes, or 0 when unavailable
         */
        private long freeBytesFromJvm() {
            try {
                return Math.max(0,
                        ManagementFactory.getPlatformMXBean(OperatingSystemMXBean.class).getFreeMemorySize());
            } catch (Exception e) {
                return 0;
            }
        }

        /**
         * Whether the current platform is macOS.
         * @return true on macOS
         */
        private boolean isMac() {
            String os = System.getProperty("os.name", "");
            return os.toLowerCase().contains("mac");
        }

        /**
         * Gets disk partition information (via the df command)
         * @return JSON array containing the information of each partition
         */
        private JSONArray getDiskInfo() {
            JSONArray disks = new JSONArray();
            try {
                String output = runCommand("bash", "-c",
                        "LC_ALL=C df -k 2>/dev/null | awk 'NR>1 && !/tmpfs|devtmpfs|overlay|none/'");
                if (output != null && !output.isEmpty()) {
                    String[] lines = output.split("\n");
                    for (String line : lines) {
                        String[] parts = line.trim().split("\\s+");
                        if (parts.length >= 6 && parts[0].startsWith("/")) {
                            try {
                                long sizeKb = Long.parseLong(parts[1]);
                                long usedKb = Long.parseLong(parts[2]);
                                long availKb = Long.parseLong(parts[3]);
                                double sizeGb = Math.round(sizeKb / 1024.0 / 1024.0 * 100.0) / 100.0;
                                double usedGb = Math.round(usedKb / 1024.0 / 1024.0 * 100.0) / 100.0;
                                double availGb = Math.round(availKb / 1024.0 / 1024.0 * 100.0) / 100.0;
                                String usePercent = parts[4].replace("%", "");
                                double usagePercent = Double.parseDouble(usePercent);
                                JSONObject disk = new JSONObject();
                                disk.put("partition", parts[0]);
                                disk.put("size", sizeGb);
                                disk.put("used", usedGb);
                                disk.put("available", availGb);
                                disk.put("usage_percent", usagePercent);
                                disks.add(disk);
                            } catch (NumberFormatException ignored) {
                            }
                        }
                    }
                }
            } catch (Exception e) {
                // return empty array
            }
            return disks;
        }

        // ======================== 2. Backend service status ========================

        /**
         * Gets the running status of the current backend service (dataagent-backend)
         * @return JSON object containing the backend service information
         */
        public JSONObject getBackendInfo() {
            JSONObject backend = new JSONObject();
            JSONObject service = getDefaultServiceJson("dataagent-backend");
            try {
                long pid = ProcessHandle.current().pid();
                service.put("pid", String.valueOf(pid));
                JSONObject detail = getServiceDetail(String.valueOf(pid));
                service.put("status", "running");
                service.put("cpu_percent", detail.getDouble("cpu_percent"));
                service.put("memory_mb", detail.getDouble("memory_mb"));
                service.put("uptime_seconds", detail.getLong("uptime_seconds"));
                if (detail.containsKey("user") && !detail.getString("user").isEmpty()) {
                    service.put("user", detail.getString("user"));
                }
            } catch (Exception e) {
                // keep defaults
            }
            backend.put("service", service);
            return backend;
        }

        // ======================== Helper methods ========================

        /**
         * Builds the default service JSON object (status is stopped)
         * @param name service name
         * @return default service JSON
         */
        private JSONObject getDefaultServiceJson(String name) {
            JSONObject svc = new JSONObject();
            svc.put("name", name);
            svc.put("status", "stopped");
            svc.put("pid", "");
            svc.put("user", "matrix");
            svc.put("cpu_percent", 0);
            svc.put("memory_mb", 0);
            svc.put("uptime_seconds", 0);
            return svc;
        }

        /**
         * Gets the CPU, memory, running time and user information of the specified process via the ps command
         * @param pid process ID
         * @return JSON object containing the process details
         */
        private JSONObject getServiceDetail(String pid) {
            JSONObject detail = new JSONObject();
            detail.put("cpu_percent", 0);
            detail.put("memory_mb", 0);
            detail.put("uptime_seconds", 0);
            detail.put("user", "");
            try {
                String output = runCommand("ps", "-p", pid, "-o", "pcpu=,rss=,etime=,user=");
                if (output != null && !output.trim().isEmpty()) {
                    String[] parts = output.trim().split("\\s+");
                    if (parts.length >= 3) {
                        detail.put("cpu_percent", Double.parseDouble(parts[0]));
                        long rssKb = Long.parseLong(parts[1]);
                        detail.put("memory_mb", Math.round(rssKb / 1024.0 * 100.0) / 100.0);
                        detail.put("uptime_seconds", parseEtimeToSeconds(parts[2]));
                    }
                    if (parts.length >= 4) {
                        detail.put("user", parts[3]);
                    }
                }
            } catch (Exception e) {
                // keep defaults
            }
            return detail;
        }

        /**
         * Gets the current hostname
         * @return hostname string, returns "unknown" when retrieval fails
         */
        private String getHostname() {
            try {
                return InetAddress.getLocalHost().getHostName();
            } catch (Exception e) {
                try {
                    String output = runCommand("hostname");
                    if (output != null) {
                        return output.trim();
                    }
                } catch (Exception ignored) {
                }
                return "unknown";
            }
        }

        // ======================== Parsing utility methods ========================

        /**
         * Converts the running time in ps etime format to seconds
         * Format examples: 1-02:30:45 / 02:30:45 / 30:45
         * @param etime running time string output by ps
         * @return total seconds
         */
        private long parseEtimeToSeconds(String etime) {
            if (etime == null || etime.isEmpty()) {
                return 0;
            }
            Matcher m = ETIME_PATTERN.matcher(etime);
            if (m.find()) {
                long total = 0;
                String daysStr = m.group(1);
                String hoursStr = m.group(2);
                String minsStr = m.group(3);
                String secsStr = m.group(4);
                if (daysStr != null) {
                    total += Long.parseLong(daysStr) * 86400;
                }
                if (hoursStr != null) {
                    total += Long.parseLong(hoursStr) * 3600;
                }
                total += Long.parseLong(minsStr) * 60;
                total += Long.parseLong(secsStr);
                return total;
            }
            return 0;
        }

        // ======================== Command line utility methods ========================

        /**
         * Executes a system command and returns the output content
         * @param cmd the command and its arguments
         * @return command output, or null when execution fails
         */
        private String runCommand(String... cmd) {
            try {
                ProcessBuilder pb = new ProcessBuilder(cmd);
                pb.redirectErrorStream(true);
                Process p = pb.start();
                String output = readProcessOutput(p);
                p.waitFor(10, java.util.concurrent.TimeUnit.SECONDS);
                return output;
            } catch (Exception e) {
                return null;
            }
        }

        /**
         * Reads the output stream of the process and returns the string content
         * @param p system process object
         * @return process output content
         * @throws IOException thrown when reading fails
         */
        private String readProcessOutput(Process p) throws IOException {
            StringBuilder sb = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line).append("\n");
                }
            }
            return sb.toString();
        }
}

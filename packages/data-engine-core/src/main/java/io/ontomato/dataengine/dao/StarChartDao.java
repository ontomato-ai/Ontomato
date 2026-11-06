package io.ontomato.dataengine.dao;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;

import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("starChartDao")
public class StarChartDao {

	private String dirName = "starChart";
	
	public void writeWholeData(JSONObject data, String mode, String suffix, String domainId) {
		FileOutputStream fos = null;
		try {
			File file = new File("conf/" + dirName + "/wholeData-" + mode + "-" + suffix + "-" + domainId + ".json");
			file.getParentFile().mkdirs();
			fos = new FileOutputStream(file);
			fos.write(JSON.toJSONString(data, Feature.WriteMapNullValue).getBytes("utf-8"));
		} catch (Exception e) {
			throw new RuntimeException("Failed to write star chart data: mode=" + mode + ", suffix=" + suffix + ", domainId=" + domainId, e);
		} finally {
			if (fos != null) {
				try {
					fos.close();
				} catch (Exception e) {
					log.error(e.getMessage(), e);
				}
			}
		}
	}

	public JSONObject readWholeData(String mode, String suffix, String domainId) {
		FileInputStream fis = null;
		try {
			fis = new FileInputStream(new File("conf/" + dirName + "/wholeData-" + mode + "-" + suffix + "-" + domainId + ".json"));
			JSONObject data = JSONObject.parseObject(new String(fis.readAllBytes(), "utf-8"));
			return data;
		} catch (Exception e) {
			throw new RuntimeException("Failed to read star chart data: mode=" + mode + ", suffix=" + suffix + ", domainId=" + domainId, e);
		} finally {
			if (fis != null) {
				try {
					fis.close();
				} catch (Exception e) {
					log.error(e.getMessage(), e);
				}
			}
		}
	}

	/**
	 * The suffix whose two files hold the domain's last complete generation, or null when none has completed. It is
	 * recorded on disk beside the files, so a restarted process reads the same answer the previous one served.
	 */
	public String readCurrentSuffix(String domainId) {
		Path file = currentSuffixFile(domainId);
		if (!Files.exists(file)) {
			return null;
		}
		try {
			return Files.readString(file, StandardCharsets.UTF_8).trim();
		} catch (IOException e) {
			throw new RuntimeException("Failed to read star chart current suffix: domainId=" + domainId, e);
		}
	}

	/**
	 * Records the suffix of a generation whose two files are both written. The record is replaced in one rename, so a
	 * stop at any moment leaves either the previous record or this one, never a partial one. One generation per domain
	 * runs at a time (DataServiceImpl), so the pending file beside it is this write's own.
	 */
	public void writeCurrentSuffix(String suffix, String domainId) {
		Path file = currentSuffixFile(domainId);
		Path pending = file.resolveSibling(file.getFileName() + ".tmp");
		try {
			Files.createDirectories(file.getParent());
			try {
				Files.writeString(pending, suffix, StandardCharsets.UTF_8);
				Files.move(pending, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
			} finally {
				Files.deleteIfExists(pending);
			}
		} catch (IOException e) {
			throw new RuntimeException("Failed to record star chart current suffix: suffix=" + suffix + ", domainId=" + domainId, e);
		}
	}

	private Path currentSuffixFile(String domainId) {
		return Paths.get("conf", dirName, "current-" + domainId + ".txt");
	}

}

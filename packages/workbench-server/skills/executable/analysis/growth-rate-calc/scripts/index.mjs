export async function execute(input) {
  const { data, query = "" } = input;

  if (!data || data.length === 0) {
    return {
      json: { success: false, error: "Data is empty", results: [] },
      meta: { skillId: "growth-rate-calc" },
    };
  }

  const fields = Object.keys(data[0] || {});
  let { timeField, valueField } = input;
  timeField ||= inferTimeField(fields, data);
  valueField ||= inferValueField(fields, data, timeField, query);

  if (!timeField || !valueField) {
    return {
      json: {
        success: false,
        error: "Missing required parameters: timeField, valueField",
        results: [],
        missingParams: { timeField, valueField },
      },
      meta: { skillId: "growth-rate-calc" },
    };
  }

  if (!fields.includes(timeField)) {
    return {
      json: {
        success: false,
        error: `Time field "${timeField}" does not exist in data`,
        results: [],
        availableFields: fields,
      },
      meta: { skillId: "growth-rate-calc" },
    };
  }

  if (!fields.includes(valueField)) {
    return {
      json: {
        success: false,
        error: `Value field "${valueField}" does not exist in data`,
        results: [],
        availableFields: fields,
      },
      meta: { skillId: "growth-rate-calc" },
    };
  }

  console.log(
    `[growth-rate-calc] timeField=${timeField}, valueField=${valueField}, rows=${data.length}`
  );

  const sortedData = [...data].sort((a, b) => {
    const aTime = String(a[timeField] || "");
    const bTime = String(b[timeField] || "");
    return aTime.localeCompare(bTime);
  });

  const results = sortedData.map((current, index) => {
    const currentValue = Number(current[valueField]) || 0;
    const period = String(current[timeField] || `Period ${index + 1}`);

    let momGrowth = null;
    if (index > 0) {
      const prevValue = Number(sortedData[index - 1][valueField]) || 0;
      if (prevValue !== 0) {
        momGrowth = (currentValue - prevValue) / prevValue;
        momGrowth = Math.round(momGrowth * 10000) / 100;
      }
    }

    let yoyGrowth = null;
    if (index >= 12) {
      const lastYearValue = Number(sortedData[index - 12][valueField]) || 0;
      if (lastYearValue !== 0) {
        yoyGrowth = (currentValue - lastYearValue) / lastYearValue;
        yoyGrowth = Math.round(yoyGrowth * 10000) / 100;
      }
    }

    return { period, value: currentValue, momGrowth, yoyGrowth };
  });

  const values = sortedData.map((d) => Number(d[valueField]) || 0);
  const totalGrowth =
    values.length > 1 && values[0] !== 0
      ? Math.round(((values[values.length - 1] - values[0]) / values[0]) * 10000) / 100
      : null;

  return {
    json: {
      success: true,
      timeField,
      valueField,
      results,
      summary: {
        totalPeriods: sortedData.length,
        totalGrowth,
        avgValue: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100,
        maxValue: Math.max(...values),
        minValue: Math.min(...values),
      },
    },
    meta: {
      skillId: "growth-rate-calc",
      timeField,
      valueField,
      resultCount: results.length,
    },
  };
}

function inferTimeField(fields, data) {
  const namedField = fields.find((field) =>
    /(^|_)(time|date|year|month|day|quarter|period|week)(_|$)|time|date|year|quarter|month|week|\u65f6\u95f4|\u65e5\u671f|\u5e74|\u5b63\u5ea6|\u6708|\u5468/i.test(field)
  );
  if (namedField) return namedField;

  return fields.find((field) =>
    data
      .slice(0, 5)
      .some((row) => typeof row[field] === "string" && Number.isNaN(Number(row[field])))
  );
}

function inferValueField(fields, data, timeField, query) {
  const numericFields = fields.filter(
    (field) =>
      field !== timeField &&
      data
        .slice(0, 5)
        .some(
          (row) => row[field] !== null && row[field] !== "" && Number.isFinite(Number(row[field]))
        )
  );
  const normalizedQuery = String(query).toLowerCase();
  return (
    numericFields.find((field) => normalizedQuery.includes(field.toLowerCase())) ||
    numericFields.find((field) =>
      /sales|revenue|amount|quantity|headcount|count|value|gdp|\u9500\u552e\u989d|\u6536\u5165|\u91d1\u989d|\u6570\u91cf|\u4eba\u6570/i.test(field)
    ) ||
    numericFields[0]
  );
}

// The exported calculation/rendering function is also usable as an ordinary CLI.
if (import.meta.main) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { randomUUID } = await import("node:crypto");
  const source = process.argv[2]?.replace(/^@/, "");
  if (!source) throw new Error("Expected a JSON input file");
  const result = await execute(JSON.parse(await fs.readFile(source, "utf8")));
  if (result.meta?.error || result.json?.success === false)
    throw new Error(result.json?.error || "Skill could not produce the requested result");
  const root = process.env.ONTOMATO_OUTPUT_DIR || "outputs";
  const output = path.join(root, "growth-rate-calc." + (result.html ? "html" : "json"));
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir("work", { recursive: true });
  const temporary = path.join("work", randomUUID() + ".tmp");
  try {
    await fs.writeFile(temporary, result.html ?? JSON.stringify(result.json ?? result, null, 2));
    await fs.rename(temporary, output);
  } finally { await fs.rm(temporary, { force: true }); }
  if (result.meta) console.log(JSON.stringify(result.meta));
  console.log(path.relative(process.cwd(), path.resolve(output)));
}

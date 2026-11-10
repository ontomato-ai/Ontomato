import { expect, it } from "vitest";
import { parseCsv } from "../table-data";

// Every page that shows a CSV or TSV file reads it with this one parser, so the same file shows the same cells there.
const cells = {
  columns: ["name", "note", "amount"],
  rows: [
    ["  Alice ", 'said "hi", then left', "1,200"],
    ["Bob", "first line\nsecond line", ""],
  ],
};

it("reads quoted fields, doubled quotes, line breaks inside fields and spaces of a CSV as they are", () => {
  const csv = '﻿name,note,amount\r\n  Alice ,"said ""hi"", then left","1,200"\r\nBob,"first line\nsecond line",\r\n';
  expect(parseCsv(csv)).toEqual(cells);
});

it("reads a TSV the same way, with a tab between fields", () => {
  const tsv = 'name\tnote\tamount\n  Alice \t"said ""hi"", then left"\t1,200\nBob\t"first line\nsecond line"\t\n';
  expect(parseCsv(tsv, "\t")).toEqual(cells);
});

import { expect, it } from "vitest";
import { externalLinkOf } from "../external-link";

/*
 * An entry's external link is its own address with the flag (big main's ruling, 2026-11-21): the state the reader is at
 * and anything else the address carries stay as they are, so the link opens the same page in the same state.
 */
it("keeps the entry's address and state, and adds the flag", () => {
  const at = { origin: "https://ontomato.example", pathname: "/app/" };
  const state = encodeURIComponent(JSON.stringify({ selected: { className: "Course", primaryKey: "c1" } }));
  const link = externalLinkOf(`/applications/app-school/orders?frame=%7B%22term%22%3A%22A%22%7D&state=${state}`, at);
  const url = new URL(link);
  expect(url.origin + url.pathname).toBe("https://ontomato.example/app/");
  const [path, search] = url.hash.slice(1).split("?");
  expect(path).toBe("/applications/app-school/orders");
  const query = new URLSearchParams(search);
  expect(query.get("standalone")).toBe("1");
  expect(JSON.parse(query.get("state")!)).toEqual({ selected: { className: "Course", primaryKey: "c1" } });
  expect(JSON.parse(query.get("frame")!)).toEqual({ term: "A" });
  expect(externalLinkOf("/applications/app-school/orders", at)).toBe("https://ontomato.example/app/#/applications/app-school/orders?standalone=1");
});

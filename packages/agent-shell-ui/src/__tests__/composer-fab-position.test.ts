import { expect, it } from "vitest";
import {
  clampComposerFabPosition,
  composerFabArea,
  draggedComposerFabPosition,
  readComposerFabPosition,
  writeComposerFabPosition,
} from "../composer-fab-position";

const area = { width: 500, height: 400 };
const button = { width: 44, height: 44 };

it("keeps the button inside its page area, including areas smaller than the button", () => {
  expect(clampComposerFabPosition({ right: 120, bottom: 90 }, area, button)).toEqual({ right: 120, bottom: 90 });
  expect(clampComposerFabPosition({ right: 490, bottom: 390 }, area, button)).toEqual({ right: 456, bottom: 356 });
  expect(clampComposerFabPosition({ right: -10, bottom: -20 }, area, button)).toEqual({ right: 0, bottom: 0 });
  expect(clampComposerFabPosition({ right: 30, bottom: 30 }, { width: 30, height: 20 }, button)).toEqual({ right: 0, bottom: 0 });
});

it("follows the pointer in both directions while staying inside the page area", () => {
  // Up and left increase the inward distances; down and right decrease them.
  expect(draggedComposerFabPosition({ right: 100, bottom: 100 }, -80, -60, area, button)).toEqual({ right: 180, bottom: 160 });
  expect(draggedComposerFabPosition({ right: 100, bottom: 100 }, 70, 50, area, button)).toEqual({ right: 30, bottom: 50 });
  expect(draggedComposerFabPosition({ right: 100, bottom: 100 }, -500, -500, area, button)).toEqual({ right: 456, bottom: 356 });
  expect(draggedComposerFabPosition({ right: 100, bottom: 100 }, 500, 500, area, button)).toEqual({ right: 0, bottom: 0 });
});

it("remembers only a valid position in this browser", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
  writeComposerFabPosition({ right: 123.5, bottom: 45.25 }, storage);
  expect(readComposerFabPosition(storage)).toEqual({ right: 123.5, bottom: 45.25 });

  values.set("ontomato.shell.composerFabPosition", "not json");
  expect(readComposerFabPosition(storage)).toBeNull();
  values.set("ontomato.shell.composerFabPosition", JSON.stringify({ right: -1, bottom: 20 }));
  expect(readComposerFabPosition(storage)).toBeNull();
  values.set("ontomato.shell.composerFabPosition", JSON.stringify({ right: Number.NaN, bottom: 20 }));
  expect(readComposerFabPosition(storage)).toBeNull();
});

it("takes the first relatively positioned ancestor above the zero-height dock as the page area", () => {
  const page = document.createElement("section");
  page.style.position = "relative";
  const dock = document.createElement("div");
  dock.style.position = "absolute";
  const wrapper = document.createElement("div");
  const buttonElement = document.createElement("button");
  page.append(dock);
  dock.append(wrapper);
  wrapper.append(buttonElement);
  document.body.append(page);

  expect(composerFabArea(buttonElement)).toBe(page);
  page.remove();
});

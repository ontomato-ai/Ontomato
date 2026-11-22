import { expect, it } from "vitest";
import { themeDerivedProperties } from "../index";

/*
 * A theme that recolours one of Element Plus's colour families in an area (product-layer standard, the theme layers):
 * Element Plus works the family's shades out once, on the page's root, so an area that assigns only the colour keeps the
 * platform's shades — the focus ring, a hovered button, a soft fill stay the platform's blue. The area declares the
 * shades again from its own colour and surface, by the rule the brand's own shades follow, in each mode that it assigns.
 */

it("works out a recoloured family's shades from the area's own colour and surface, by the brand's rule", () => {
  const derived = themeDerivedProperties({ "--sdk-color-primary": "#0f7b6c" });
  expect(derived["--sdk-color-primary-light-3"]).toBe("color-mix(in srgb, var(--sdk-color-primary), var(--sdk-bg-color) 30%)");
  expect(derived["--sdk-color-primary-light-8"]).toBe("color-mix(in srgb, var(--sdk-color-primary), var(--sdk-bg-color) 80%)");
  expect(derived["--sdk-color-primary-light-9"]).toBe("color-mix(in srgb, var(--sdk-color-primary), var(--sdk-bg-color) 90%)");
  expect(derived["--sdk-color-primary-dark-2"]).toBe("color-mix(in srgb, var(--sdk-color-primary), var(--sdk-text-color-primary) 20%)");
  expect(derived["--sdk-color-primary-rgb"]).toBe("15, 123, 108");
  // Internal Element Plus mirrors follow the SDK theme override so underlying UI primitives recolour inside the area.
  expect(derived["--el-color-primary"]).toBe("#0f7b6c");
  expect(derived["--el-color-primary-light-3"]).toBe("color-mix(in srgb, var(--el-color-primary), var(--el-bg-color) 30%)");
  expect(derived["--el-color-primary-rgb"]).toBe("15, 123, 108");
  // The platform's own roles that follow primary: the soft fill, a hovered primary button and link text.
  expect(derived["--brand-primary-tint"]).toBe("color-mix(in srgb, var(--sdk-color-primary), var(--sdk-bg-color) 90%)");
  expect(derived["--brand-primary-hover"]).toBe("var(--sdk-color-primary-light-3)");
  expect(derived["--brand-link"]).toBe("var(--sdk-color-primary)");
});

it("keeps what the theme assigns itself, recolours error with danger, and adds nothing for non-SDK tokens", () => {
  const derived = themeDerivedProperties({ "--sdk-color-primary": "rgb(1, 2, 3)", "--brand-link": "#123456", "--sdk-color-danger": "#c00" });
  expect(derived["--brand-link"]).toBeUndefined();
  expect(derived["--sdk-color-primary-rgb"]).toBe("1, 2, 3");
  expect(derived["--sdk-color-danger-rgb"]).toBe("204, 0, 0");
  expect(derived["--el-color-error"]).toBe("var(--el-color-danger)");
  expect(derived["--el-color-error-light-5"]).toBe("color-mix(in srgb, var(--el-color-error), var(--el-bg-color) 50%)");
  expect(themeDerivedProperties({ "--radius-md": "4px" })).toEqual({});
  expect(themeDerivedProperties({ "--radius-md": "4px", "--sdk-bg-color": "#fff" })).toEqual({ "--el-bg-color": "#fff" });
});

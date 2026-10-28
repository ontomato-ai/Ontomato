export interface WorkbenchAppearance {
  brand: { name: string; subtitle: string; logo: string };
}

export type AppearanceSection = keyof WorkbenchAppearance;

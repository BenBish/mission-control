declare module "react-syntax-highlighter" {
  import { ComponentType } from "react";

  interface PrismProps {
    children: string;
    language?: string;
    style?: Record<string, unknown>;
    [key: string]: unknown;
  }

  export const Prism: ComponentType<PrismProps>;
}

declare module "react-syntax-highlighter/dist/esm/styles/prism" {
  const oneDark: Record<string, unknown>;
  export { oneDark };
}

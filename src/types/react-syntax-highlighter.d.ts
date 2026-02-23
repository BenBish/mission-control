declare module 'react-syntax-highlighter' {
  import { ReactNode } from 'react';
  
  interface PrismProps {
    children: string;
    language?: string;
    style?: Record<string, any>;
    [key: string]: any;
  }
  
  export const Prism: React.ComponentType<PrismProps>;
}

declare module 'react-syntax-highlighter/dist/esm/styles/prism' {
  export const oneDark: Record<string, any>;
  [key: string]: Record<string, any>;
}

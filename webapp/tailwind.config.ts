import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Lynx brand
        lynx: {
          green: "#C6F21F",
          charcoal: "#1C1C1C",
          gray: "#F5F5F5",
        },
        // shadcn-flavored design tokens, mapped to brand
        background: "#FFFFFF",
        foreground: "#1C1C1C",
        muted: { DEFAULT: "#F5F5F5", foreground: "#5A5A5A" },
        accent: { DEFAULT: "#C6F21F", foreground: "#1C1C1C" },
        border: "#E5E5E5",
        input: "#E5E5E5",
        ring: "#C6F21F",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        heading: ["Montserrat", "Inter", "ui-sans-serif", "sans-serif"],
      },
      borderRadius: {
        lg: "0.75rem",
        md: "0.5rem",
        sm: "0.375rem",
      },
    },
  },
  plugins: [],
};

export default config;

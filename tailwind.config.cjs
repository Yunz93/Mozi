/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./index.tsx", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: "#007AFF",
          hover: "#0056b3",
        },
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.95)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "progress-indeterminate": {
          "0%": { transform: "translateX(-120%)" },
          "100%": { transform: "translateX(320%)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.15s ease-out",
        "scale-in": "scale-in 0.15s ease-out",
        "fade-in-02s": "fade-in 0.2s ease-out",
        "progress-indeterminate":
          "progress-indeterminate 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

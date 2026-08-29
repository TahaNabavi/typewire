import type { NextConfig } from "next";

const config: NextConfig = {
  // The site links out to npm, GitHub and shields.io constantly; keep those
  // rewrites and redirects in one place as they appear.
  async redirects() {
    return [
      { source: "/github", destination: "https://github.com/TahaNabavi/typewire", permanent: false },
      { source: "/npm", destination: "https://www.npmjs.com/org/tahanabavi", permanent: false },
    ];
  },
};

export default config;

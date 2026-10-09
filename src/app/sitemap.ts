import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

export default function sitemap(): MetadataRoute.Sitemap {
  const U = env.siteUrl;
  return ["/", "/ai", "/society", "/skill.md", "/llms.txt", "/openapi.json"].map((p) => ({ url: `${U}${p}`, changeFrequency: "hourly", priority: p === "/" ? 1 : 0.7 }));
}

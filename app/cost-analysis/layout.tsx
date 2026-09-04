import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Steel Cost Analysis | Winding Intelligence",
  description: "Review 510-series steel parts, winding-sheet steel weight, price sources, and cost freshness.",
};

export default function CostAnalysisLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}

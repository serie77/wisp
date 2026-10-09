import Link from "next/link";
import { Glyph } from "@/components/Glyph";
import { GlyphHero } from "@/components/GlyphScene";

export default function NotFound() {
  return (
    <GlyphHero controls={false} initial={{ scene: 3, cell: 12, contrast: 1.3, mark: "glyph", palette: 3, offset: [0.9, 0], scale: 1.5 }} mobile={{ offset: [0, 0.3], scale: 1.0, cell: 9 }}>
      <div className="container flex min-h-[calc(100vh-4rem)] flex-col justify-end pb-14 pt-24 lg:justify-center lg:pb-0 lg:pt-0">
        <h1 className="display h-hero"><Glyph text="Nothing here." /></h1>
        <div className="mt-8"><Link href="/" className="btn btn-ink">Home</Link></div>
      </div>
    </GlyphHero>
  );
}

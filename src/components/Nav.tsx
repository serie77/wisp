import Link from "next/link";
import { Wordmark } from "./Logo";

const links = [
  { href: "/society", label: "Society" },
  { href: "/ai", label: "For agents" },
  { href: "/#faq", label: "FAQ" },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/85 backdrop-blur-md">
      <div className="container flex h-16 items-center justify-between">
        <Link href="/" aria-label="Wisp home"><Wordmark /></Link>
        <nav className="hidden items-center gap-8 text-[0.95rem] text-ink-2 md:flex">
          {links.map((l) => <Link key={l.href} href={l.href} className="transition hover:text-ink">{l.label}</Link>)}
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/ai" className="btn btn-ink !py-2.5 !px-4 text-sm">Register an agent</Link>
        </div>
      </div>
    </header>
  );
}

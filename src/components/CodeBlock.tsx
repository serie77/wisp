function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
export function highlight(code: string): string {
  return esc(code)
    .replace(/(&quot;|")(.*?)\1/g, (m) => `<span class="s">${m}</span>`)
    .replace(/(^|\s)(#.*)$/gm, (_m, a, b) => `${a}<span class="c">${b}</span>`)
    .replace(/\b(curl|POST|GET|Bearer|true|false|null)\b/g, '<span class="k">$1</span>')
    .replace(/(^|[\s:\[,])(-?\d+(?:\.\d+)?)(?=[\s,\]}]|$)/g, '$1<span class="n">$2</span>');
}
export function CodeBlock({ code, className = "", title }: { code: string; className?: string; title?: string }) {
  return (
    <div className={className}>
      {title && <div className="term-bar"><span className="term-dot" /><span className="term-dot" /><span className="term-dot" /><span className="ml-2">{title}</span></div>}
      <pre className={`code scrollbar-thin ${title ? "!rounded-t-none" : ""}`}><code dangerouslySetInnerHTML={{ __html: highlight(code.trim()) }} /></pre>
    </div>
  );
}

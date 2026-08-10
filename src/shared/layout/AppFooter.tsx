import { ExternalLink, Heart } from "lucide-react";

const projectLinks = [
  {
    label: "GitHub",
    href: "https://github.com/dobria/zt-control-plane",
    compact: true,
  },
  {
    label: "Documentation",
    href: "https://github.com/dobria/zt-control-plane#readme",
  },
  {
    label: "Report an issue",
    href: "https://github.com/dobria/zt-control-plane/issues/new/choose",
  },
  {
    label: "Security",
    href: "https://github.com/dobria/zt-control-plane/security/policy",
  },
  {
    label: "Apache-2.0",
    href: "https://github.com/dobria/zt-control-plane/blob/main/LICENSE",
    compact: true,
  },
  {
    label: "ZeroTier docs",
    href: "https://docs.zerotier.com/",
  },
] as const;

export function AppFooter({ compact = false }: { compact?: boolean }) {
  const version = process.env.NEXT_PUBLIC_APP_VERSION || "development";
  const visibleLinks = compact
    ? projectLinks.filter((link) => "compact" in link && link.compact)
    : projectLinks;

  return (
    <footer className={`app-footer ${compact ? "compact" : ""}`}>
      <div className="app-footer-inner">
        <div className="app-footer-main">
          <div className="app-footer-product">
            <strong>ZT Control Plane</strong>
            <span className="mono">v{version}</span>
          </div>
          <nav className="app-footer-links" aria-label="Project resources">
            {visibleLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noreferrer noopener"
              >
                {link.label}
                <ExternalLink aria-hidden="true" />
              </a>
            ))}
            <a
              className="app-footer-sponsor"
              href="https://github.com/sponsors/dobria"
              target="_blank"
              rel="noreferrer noopener"
            >
              <Heart aria-hidden="true" />
              Sponsor
              <ExternalLink aria-hidden="true" />
            </a>
          </nav>
        </div>
        <p className="app-footer-disclaimer">
          Independent open-source project. Not affiliated with or endorsed by
          ZeroTier, Inc.
        </p>
      </div>
    </footer>
  );
}

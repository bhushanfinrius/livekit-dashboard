import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bot,
  DoorOpen,
  History,
  KeyRound,
  LayoutDashboard,
  Phone,
  ScrollText,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavChild = {
  href: string;
  label: string;
};

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  children?: NavChild[];
};

export function getDashboardNav(projectId: string): NavItem[] {
  const base = `/dashboard/${projectId}`;
  return [
    { href: base, label: "Overview", icon: LayoutDashboard, exact: true },
    { href: `${base}/rooms`, label: "Rooms", icon: DoorOpen },
    {
      href: `${base}/telephony`,
      label: "Telephony",
      icon: Phone,
      children: [
        { href: `${base}/telephony/calls`, label: "Calls" },
        { href: `${base}/telephony/dispatch`, label: "Dispatch rules" },
        { href: `${base}/telephony/trunks`, label: "SIP trunks" },
      ],
    },
    { href: `${base}/agents`, label: "Agents", icon: Bot },
    { href: `${base}/sessions`, label: "Sessions", icon: History },
    { href: `${base}/egress`, label: "Egresses", icon: ArrowUpFromLine },
    { href: `${base}/ingress`, label: "Ingresses", icon: ArrowDownToLine },
    { href: `${base}/events`, label: "Events", icon: ScrollText },
    { href: `${base}/api-keys`, label: "API keys", icon: KeyRound },
    { href: `${base}/settings`, label: "Settings", icon: Settings },
  ];
}

export function getPageMeta(pathname: string): { title: string; subtitle: string } {
  if (pathname.includes("/telephony/calls")) {
    return {
      title: "Calls",
      subtitle: "SIP participants reconstructed from join/leave webhooks",
    };
  }
  if (pathname.includes("/telephony/dispatch")) {
    return {
      title: "Dispatch rules",
      subtitle: "Route inbound SIP trunks into rooms",
    };
  }
  if (pathname.includes("/telephony/trunks")) {
    return {
      title: "SIP trunks",
      subtitle: "Inbound and outbound trunks on this LiveKit server",
    };
  }
  if (pathname.includes("/telephony")) {
    return {
      title: "Telephony",
      subtitle: "SIP trunks, dispatch rules, and calls",
    };
  }
  if (pathname.endsWith("/rooms")) {
    return {
      title: "Rooms",
      subtitle: "Active rooms on this LiveKit server",
    };
  }
  if (pathname.endsWith("/agents")) {
    return {
      title: "Agents",
      subtitle: "",
    };
  }
  if (pathname.includes("/sessions/") && !pathname.endsWith("/sessions")) {
    return {
      title: "Session",
      subtitle: "Room lifetime reconstructed from webhooks",
    };
  }
  if (pathname.endsWith("/sessions")) {
    return {
      title: "Sessions",
      subtitle: "Past rooms from webhook start/finish pairs",
    };
  }
  if (pathname.endsWith("/egress") || pathname.endsWith("/egress-ingress")) {
    return {
      title: "Egresses",
      subtitle: "Recording and stream export jobs",
    };
  }
  if (pathname.endsWith("/ingress")) {
    return {
      title: "Ingresses",
      subtitle: "Inbound RTMP, WHIP, and URL endpoints",
    };
  }
  if (pathname.endsWith("/events")) {
    return {
      title: "Events",
      subtitle: "Searchable webhook log with raw payloads",
    };
  }
  if (pathname.endsWith("/api-keys")) {
    return {
      title: "API keys",
      subtitle: "Manage project access keys",
    };
  }
  if (pathname.endsWith("/settings")) {
    return {
      title: "Settings",
      subtitle: "Project credentials, members, and danger zone",
    };
  }
  return {
    title: "Overview",
    subtitle: "Usage and connection health",
  };
}

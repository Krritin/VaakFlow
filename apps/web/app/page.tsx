"use client";

// Landing page = the Stitch design served as a standalone document
// (public/landing.html) inside a full-bleed iframe. Isolating it keeps its
// Tailwind CDN + preflight from leaking into the app's own CSS. The Login
// links inside use <base target="_top">, so they navigate the top window to
// /login. Already-logged-in visitors skip straight to their home.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession, homeFor } from "../lib/auth";

export default function LandingPage() {
  const router = useRouter();
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    const s = getSession();
    if (s) {
      setRedirecting(true);
      router.replace(homeFor(s.role));
    }
  }, [router]);

  if (redirecting) return null;

  return (
    <iframe
      src="/landing.html?v=6"
      title="VaakFlow — voice-AI platform for field operations"
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        border: "none",
        display: "block",
      }}
    />
  );
}

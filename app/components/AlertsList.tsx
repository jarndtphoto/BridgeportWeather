"use client";
import { useEffect, useState } from "react";
import type { NwsAlert } from "../../lib/nws";
type AlertsResponse = { here: NwsAlert[]; nearby: NwsAlert[] };
function formatUntil(expires: string): string | null { const date = new Date(expires); if (Number.isNaN(date.getTime())) return null; return `Until ${new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date)}`; }
function alertCopy(alert: NwsAlert) {
  if (alert.event === "Hydrologic Outlook") {
    return {
      title: "Flooding potential being monitored",
      detail: "NWS says additional rainfall could cause elevated water levels or localized flooding in the area. Flooding is possible, but not currently certain.",
      official: "NWS Hydrologic Outlook",
    };
  }
  return { title: alert.event, detail: null as string | null, official: null as string | null };
}
export default function AlertsList() { const [alerts, setAlerts] = useState<AlertsResponse | null>(null); const [status, setStatus] = useState<"loading" | "ready" | "error">("loading"); useEffect(() => { let active = true; async function load() { try { const response = await fetch("/api/alerts", { cache: "no-store" }); if (!response.ok) throw new Error("Alerts unavailable"); const payload = (await response.json()) as AlertsResponse; if (!active) return; setAlerts(payload); setStatus("ready"); } catch { if (active) setStatus("error"); } } void load(); const timer = window.setInterval(load, 60_000); return () => { active = false; window.clearInterval(timer); }; }, []); if (status !== "ready" || !alerts) return null; const items = [...alerts.here.map((alert) => ({ alert, nearby: false })), ...alerts.nearby.map((alert) => ({ alert, nearby: true }))]; if (!items.length) return null; return <div className="alertsList"><div className="sectionTitle"><h3>Active NWS alerts</h3><span>{alerts.here.length ? "FOR BRIDGEPORT" : "NEARBY"}</span></div><ul>{items.map(({ alert, nearby }) => { const copy = alertCopy(alert); return <li key={alert.id} className={`alertItem alertItem-${alert.severity.toLowerCase()}`}><div className="alertItemHeader"><strong>{copy.title}</strong>{nearby && alert.approxDistanceMiles !== null && <span className="alertDistance">~{alert.approxDistanceMiles.toFixed(0)} mi away</span>}</div>{copy.detail && <span className="alertPlainLanguage">{copy.detail}</span>}{copy.official && <span className="alertOfficialName">{copy.official}</span>}<span className="alertArea">{alert.areaDesc}</span>{formatUntil(alert.expires) && <span className="alertWindow">{formatUntil(alert.expires)}</span>}</li>; })}</ul></div>; }

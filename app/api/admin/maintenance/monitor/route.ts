import { NextRequest } from "next/server"
import { platformFailureFingerprint, reportPlatformFailure } from "@/lib/admin/maintenance"
import { getLiveHealthMetrics } from "@/lib/system-health/live-metrics"
import { supabaseAdmin } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: NextRequest) {
    const secret = process.env.CRON_SECRET?.trim()
    if (!secret) return Response.json({ error: "Maintenance monitor is not configured" }, { status: 503 })
    if (request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 })

    const [{ data: workspaces, error: workspaceError }, metrics] = await Promise.all([
        supabaseAdmin.from("workspaces").select("id, slug").eq("status", "active"),
        getLiveHealthMetrics(),
    ])
    if (workspaceError) return Response.json({ error: workspaceError.message }, { status: 500 })

    const critical = metrics.filter((metric) => metric.status === "critical")
    const reports = await Promise.all((workspaces ?? []).flatMap((workspace) => critical.map((metric) => reportPlatformFailure({
        workspaceId: workspace.id,
        category: "system_health",
        source: "hourly_system_health",
        operation: metric.id,
        fingerprint: platformFailureFingerprint(["system_health", metric.id]),
        severity: "critical",
        summary: `${metric.provider}: ${metric.name} requires attention`,
        diagnostics: { value: metric.value, detail: metric.detail, chart_value: metric.chartValue ?? null, chart_limit: metric.chartLimit ?? null },
        sourceHref: `/${workspace.slug}/admin/maintenance`,
    }))))

    return Response.json({
        ok: true,
        checkedMetrics: metrics.length,
        criticalMetrics: critical.length,
        workspaces: workspaces?.length ?? 0,
        reported: reports.filter((report) => report.ok).length,
    })
}

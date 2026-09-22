// Spec: 010-ai-vc-watch — 事件流页 (US-2/US-4): 过滤 + 分页 + 统计摘要 + 人工录入
// 服务端取数; 过滤/分页走 URL 参数 (DealTable 保持 Server 渲染)

import DealTable from "@/components/vc/deal-table";
import DealForm from "@/components/vc/deal-form";
import { getDealStream } from "@/application/vc-service";
import { VcDataError } from "@/infrastructure/sqlite-vc-repository";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function VcPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const sector = typeof sp.sector === "string" ? sp.sector : null;
  const source = typeof sp.source === "string" ? sp.source : null;
  const minUsdRaw = typeof sp.minUsd === "string" ? Number(sp.minUsd) : NaN;
  const minUsd = Number.isFinite(minUsdRaw) && minUsdRaw > 0 ? minUsdRaw : null;
  const page = Math.max(0, Number(typeof sp.page === "string" ? sp.page : 0) || 0);

  let stream;
  try {
    stream = await getDealStream({
      sector: sector as never,
      source: source as never,
      minUsd: minUsd ?? undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    });
  } catch (cause) {
    const message = cause instanceof VcDataError ? cause.message : "读取融资事件失败";
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-md rounded-xl border border-line bg-surface p-8 text-center">
          <div className="mb-2 text-[15px] font-semibold">数据不可用</div>
          <p className="text-[13px] leading-relaxed text-ink-muted">{message}</p>
        </div>
      </div>
    );
  }

  const updatedLabel = stream.updatedAt.slice(0, 16).replace("T", " ");

  return (
    <div className="mx-auto w-full max-w-[1180px] px-6 py-7">
      <header className="mb-5">
        <h1 className="text-[17px] font-semibold">融资事件流</h1>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
          共 <b className="font-medium text-ink">{stream.total}</b> 条 AI 融资事件，按公告日期倒序。
          金额为 USD 近似换算（原币见行内提示）；中文源反爬，走下方手动录入。
          数据更新至 {updatedLabel}。
        </p>
      </header>

      <div className="mb-5">
        <DealForm />
      </div>

      <DealTable stream={stream} sector={sector} source={source} minUsd={minUsd} page={page} />
    </div>
  );
}

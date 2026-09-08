import { NextRequest, NextResponse } from "next/server";
import { hasSiteAccess } from "../../access";
import catalog from "../../steel-pricing-catalog.json";
export const runtime = "edge";
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
export async function GET(request: NextRequest) {
  if (!await hasSiteAccess(request)) return NextResponse.json({error:"Site access is required."},{status:401});
  const source = request.nextUrl.searchParams.get("source");
  if (source !== "tempel" && source !== "vendor") return NextResponse.json({error:"Choose tempel or vendor."},{status:400});
  const title = source === "tempel" ? "Tempel pricing data" : "Dongan vendor pricing data";
  const name = source === "tempel" ? catalog.metadata.tempelSource : catalog.metadata.vendorSource;
  const headers = source === "tempel"
    ? ["510 part number","Description","Tempel part number","Effective date","Base USD/lb","Gross lb/1,000","Net lb/1,000","Surcharge code","Surcharge USD/lb","PO price USD/lb"]
    : ["510 part number","Vendor","Stock number","Description","Buy unit","Buy factor","Last cost USD/stock unit","Stock unit","Last-cost date","Quote price USD","Quote unit","Quote factor"];
  const rows = source === "tempel" ? catalog.tempel : catalog.vendor;
  const responseHeaders = {"Cache-Control":"no-store"};
  if (request.nextUrl.searchParams.get("download") === "csv") {
    const csv = [headers,...rows].map(row => row.map(value => {
      let text = String(value ?? "");
      if (typeof value === "string" && /^[\s]*[=+\-@]/.test(text)) text = "'"+text;
      return '"'+text.replace(/"/g,'""')+'"';
    }).join(",")).join("\r\n");
    return new NextResponse("\uFEFF"+csv,{headers:{...responseHeaders,"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="'+source+'-pricing-data.csv"'}});
  }
  return new NextResponse(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font:16px Arial,sans-serif;color:#173b4a;margin:32px}h1{font-size:26px}p{line-height:1.6}a{color:#006875}.wrap{overflow:auto;max-height:75vh;border:1px solid #ccd7dd}table{border-collapse:collapse;font-size:14px;white-space:nowrap;width:100%}td,th{padding:12px;text-align:left;border-bottom:1px solid #dde5e9}th{position:sticky;top:0;background:#173b4a;color:white}tr:nth-child(even){background:#f3f7f9}</style>
<h1>${title}</h1><p>Preview of the ${rows.length.toLocaleString()} imported records used by this app. Source file: ${escape(name)}.<br>This is an export of the imported pricing values, not the original workbook formatting.</p>
<p><a href="?source=${source}&download=csv">Download CSV for Excel</a> · <a href="/cost-analysis">Back to cost analysis</a></p>
<div class="wrap"><table><thead><tr>${headers.map(h=>"<th>"+escape(h)+"</th>").join("")}</tr></thead><tbody>${rows.map(row=>"<tr>"+row.map(v=>"<td>"+escape(v)+"</td>").join("")+"</tr>").join("")}</tbody></table></div></html>`,
{headers:{...responseHeaders,"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'"}});
}


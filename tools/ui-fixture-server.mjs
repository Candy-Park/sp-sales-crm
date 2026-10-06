// SYNTHETIC ONLY. No real Supabase connection.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { randomUUID } from "node:crypto";
import { handleApi } from "../src/api.mjs";
const output = "D:/AI/projects/sp-sales-crm/outputs/ui-fixture/";
await mkdir(output, { recursive: true });
await build({ entryPoints: ["web/app.mjs"], bundle: true, format: "esm", outfile: output + "app.js", alias: { "@supabase/supabase-js": "./tests/fake-supabase.mjs" } });
let fixtureProducts=[];
try{fixtureProducts=JSON.parse(await readFile(output+"../2026-10-07-products-preview.json","utf8")).products;}catch(error){if(error.code!=='ENOENT')throw error;}
const uid = "a11803c8-01ef-4563-95bb-c0024541be2c", rows = { sales_customer: [], sales_contact: [], sales_project: [], sales_inquiry: [], sales_action: [], sales_product: fixtureProducts.map(p=>({...p,enabled:true})), sales_inquiry_product: [] };
const env = { SUPABASE_URL: "https://glscckjmlwvxilzneqdf.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic" };
let failNext = false;
const stamps = () => (/* @__PURE__ */ new Date()).toISOString();
const responseError = (code) => Response.json({ code, message: "SYNTHETIC database rejection" }, { status: 400 });
async function mock(url, init) {
  url = new URL(url);
  if (url.pathname === "/auth/v1/user") return Response.json({ id: uid, email: "synthetic@example.test" });
  if (url.pathname === "/rest/v1/sales_access") return Response.json([{ user_id: uid, enabled: true }]);
  if (url.pathname.includes("/rpc/")) {
    if (failNext) {
      failNext = false;
      return responseError("XX000");
    }
    const { p_data: d, p_id: id, p_inquiry_id: iid } = JSON.parse(init.body), rpc = url.pathname.split("/").at(-1);
    if (rpc === "sales_register_inquiry") {
      let existing = rows.sales_inquiry.find((r) => r.id === d.id);
      if (existing) return Response.json(existing.id);
      let cid = d.customer_id;
      if (!cid) {
        cid = randomUUID();
        rows.sales_customer.push({ id: cid, owner_id: uid, name: d.customer_name, updated_at: stamps() });
      }
      const linked = {};
      for (const type of ["contact", "project"]) {
        linked[type + "_id"] = d[type + "_id"];
        if (d[type + "_name"]) {
          linked[type + "_id"] = randomUUID();
          rows["sales_" + type].push({ id: linked[type + "_id"], owner_id: uid, customer_id: cid, name: d[type + "_name"], updated_at: stamps(), contact_note: "", description: "" });
        }
      }
      rows.sales_inquiry.push({ ...d, ...linked, owner_id: uid, customer_id: cid, status: "new", revision: 1, created_at: stamps(), updated_at: stamps() });
      return Response.json(d.id);
    }
    if (rpc === "sales_link_product") {
      const i=rows.sales_inquiry.find(r=>r.id===iid),p=rows.sales_product.find(r=>r.id===d.product_id);
      const old=rows.sales_inquiry_product.find(r=>r.id===d.id);
      if(old)return JSON.stringify([old.inquiry_id,old.product_id,old.disposition,old.reason])===JSON.stringify([iid,d.product_id,d.disposition,d.reason])?Response.json(old.id):responseError("40001");
      if(!i||i.status==="closed"||!p)return responseError("23514");
      rows.sales_inquiry_product.unshift({...d,inquiry_id:iid,owner_id:uid,snapshot:{spec:p.spec,batch_id:p.batch_id,source_sha256:p.source_sha256,reviewed_on:p.reviewed_on},created_at:stamps()});
      return Response.json(d.id);
    }
    if (rpc === "sales_add_action") {
      const i = rows.sales_inquiry.find((r) => r.id === iid);
      if (i?.status === "closed") return responseError("23514");
      if (!rows.sales_action.some((r) => r.id === d.id)) rows.sales_action.push({ ...d, owner_id: uid, inquiry_id: iid, status: "open", revision: 1, created_at: stamps(), updated_at: stamps() });
      return Response.json(d.id);
    }
    if (rpc === "sales_edit_party") {
      const row2 = rows["sales_" + d.kind].find((r) => r.id === d.id);
      if (!row2 || row2.updated_at !== d.expected_updated_at) return responseError("40001");
      Object.assign(row2, { name: d.name, contact_note: d.note, description: d.note, updated_at: stamps() });
      return Response.json(row2.updated_at);
    }
    const row = rows[rpc === "sales_edit_action" ? "sales_action" : "sales_inquiry"].find((r) => r.id === id);
    if (!row || row.revision !== d.revision) return responseError("40001");
    if (rpc === "sales_close_inquiry") {
      if (rows.sales_action.some((a) => a.inquiry_id === id && a.status === "open" && a.mandatory)) return responseError("23514");
      row.status = "closed";
      row.closed_at = stamps();
    } else Object.assign(row, d);
    row.revision++;
    row.updated_at = stamps();
    if (row.status === "completed") row.completed_at = stamps();
    return Response.json(row.revision);
  }
  const table = url.pathname.split("/").at(-1);
  let data = rows[table] ?? [];
  if (table === "sales_action" && url.searchParams.has("sales_inquiry.status")) data = data.filter((a) => rows.sales_inquiry.find((i) => i.id === a.inquiry_id)?.status !== "closed");
  for (const [key, v] of url.searchParams) {
    if (v.startsWith("eq.")) data = data.filter((r) => String(r[key]) === v.slice(3));
    if (v.startsWith("neq.")) data = data.filter((r) => String(r[key]) !== v.slice(4));
  }
  const offset = Number(url.searchParams.get("offset") ?? 0), limit = Number(url.searchParams.get("limit") ?? 1e3);
  return Response.json(data.slice(offset, offset + limit));
}
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1:4318");
    res.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/__fixture/fail-next" && req.method === "POST") {
      failNext = true;
      res.end("armed");
      return;
    }
    if (url.pathname === "/__fixture/report") {
      res.setHeader("Content-Type", "application/json");
      const report = { synthetic: true, customers: rows.sales_customer.length, product_reviews: rows.sales_inquiry_product, inquiries: rows.sales_inquiry.map((i) => ({ status: i.status, title: i.title, original_text: i.original_text, revision: i.revision })), actions: rows.sales_action.map((a) => ({ status: a.status, description: a.description, cancel_reason: a.cancel_reason, revision: a.revision })) };
      await writeFile(output + "report.json", JSON.stringify(report, null, 2));
      res.end(JSON.stringify(report));
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const response = await handleApi(new Request(url, { method: req.method, headers: req.headers, body: req.method === "GET" ? void 0 : Buffer.concat(chunks) }), env, mock);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
      return;
    }
    if (url.pathname === "/config.json") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ url: env.SUPABASE_URL, publishableKey: env.SUPABASE_PUBLISHABLE_KEY }));
      return;
    }
    const files = { "/": ["web/index.html", "text/html"], "/app.js": [output + "app.js", "text/javascript"], "/style.css": ["web/style.css", "text/css"], "/bootstrap.css": ["node_modules/bootstrap/dist/css/bootstrap.min.css", "text/css"] };
    const file = files[url.pathname];
    if (!file) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader("Content-Type", file[1]);
    let content = await readFile(file[0]);
    if (url.pathname === "/") content = content.toString().replace("Source Photonics · Sales CRM", "SYNTHETIC TEST · Sales CRM");
    res.end(content);
  } catch {
    res.writeHead(500);
    res.end("Synthetic fixture failure");
  }
}).listen(4318, "127.0.0.1", () => console.log("SYNTHETIC ONLY browser fixture: http://127.0.0.1:4318"));

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function id(value) {
  if (typeof value !== "string" || !uuid.test(value)) throw new Error("항목 식별자를 확인해주세요.");
  return value;
}
function text(value, max, required = false) {
  if (typeof value !== "string" || value.length > max || required && !value.trim()) throw new Error("필수 내용과 입력 길이를 확인해주세요.");
  return value;
}
function date(value) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) throw new Error("기한을 확인해주세요.");
  const d = /* @__PURE__ */ new Date(value + "T00:00:00Z");
  if (!Number.isFinite(+d) || d.toISOString().slice(0, 10) !== value) throw new Error("기한을 확인해주세요.");
  return value;
}
function time(value) {
  // Keep PostgreSQL microseconds and Outlook's seven-digit round-trip timestamps intact.
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("시각을 확인해주세요.");
  date(value.slice(0, 10));
  const [, h, m, s] = /T(\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (+h > 23 || +m > 59 || +s > 59) throw new Error("접수 시각을 확인해주세요.");
  return value;
}
function revision(value) {
  if (!Number.isInteger(value) || value < 1 || value >= 2147483647) throw new Error("수정 버전을 확인해주세요.");
  return value;
}
function known(data, keys) {
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some((k) => !keys.includes(k))) throw new Error("허용되지 않은 입력입니다.");
}
const kinds = ["customer_reply", "hq_inquiry", "hq_followup", "customer_followup", "other"];
function writeInput(operation, data) {
  if (operation === "register") {
    known(data, ["id", "customer_id", "customer_name", "contact_id", "contact_name", "project_id", "project_name", "title", "channel", "received_at", "original_text", "next_action"]);
    const out = { id: id(data.id), title: text(data.title, 300, true), channel: text(data.channel, 40, true), received_at: time(data.received_at), original_text: text(data.original_text, 1e5, true), next_action: text(data.next_action ?? "", 2e3) };
    for (const type of ["customer", "contact", "project"]) {
      out[type + "_id"] = data[type + "_id"] ? id(data[type + "_id"]) : null;
      out[type + "_name"] = text(data[type + "_name"] ?? "", 200);
      if (out[type + "_id"] && out[type + "_name"].trim()) throw new Error("기존 항목과 신규 이름 중 하나를 선택해주세요.");
    }
    if (!out.customer_id && !out.customer_name.trim()) throw new Error("고객사를 선택하거나 입력해주세요.");
    return out;
  }
  if (operation === "action") {
    known(data, ["id", "kind", "description", "due_date", "mandatory", "waiting_target", "waiting_since"]);
    if (!kinds.includes(data.kind) || typeof data.mandatory !== "boolean") throw new Error("Action 종류와 필수 여부를 확인해주세요.");
    const target = text(data.waiting_target ?? "", 200);
    const since = data.waiting_since ? time(data.waiting_since) : null;
    if (Boolean(target.trim()) !== Boolean(since)) throw new Error("대기 대상과 시작 시각을 함께 입력해주세요.");
    return { id: id(data.id), kind: data.kind, description: text(data.description, 2e3, true), due_date: date(data.due_date ?? null), mandatory: data.mandatory, waiting_target: target.trim() || null, waiting_since: since };
  }
  if (operation === "action-edit") {
    known(data, ["revision", "kind", "description", "due_date", "mandatory", "waiting_target", "waiting_since", "status", "cancel_reason"]);
    if (!["open", "completed", "cancelled"].includes(data.status)) throw new Error("Action 상태를 확인해주세요.");
    const reason = text(data.cancel_reason ?? "", 2e3);
    if (data.status === "cancelled" && !reason.trim()) throw new Error("취소 사유를 입력해주세요.");
    const { revision: r, status, cancel_reason, ...fields } = data;
    const out = writeInput("action", { ...fields, id: "00000000-0000-4000-8000-000000000001" });
    delete out.id;
    return { ...out, revision: revision(r), status, cancel_reason: status === "cancelled" ? reason.trim() : null };
  }
  if (operation === "inquiry-edit") {
    known(data, ["revision", "title", "next_action"]);
    return { revision: revision(data.revision), title: text(data.title, 300, true), next_action: text(data.next_action ?? "", 2e3) };
  }
  if (operation === "close") {
    known(data, ["revision", "resolved"]);
    if (data.resolved !== true) throw new Error("주요 질문 해결 여부를 확인해주세요.");
    return { revision: revision(data.revision), resolved: true };
  }
  if (operation === "party") {
    known(data, ["kind", "id", "expected_updated_at", "name", "note"]);
    if (!["customer", "contact", "project"].includes(data.kind)) throw new Error("항목 종류를 확인해주세요.");
    return { kind: data.kind, id: id(data.id), expected_updated_at: time(data.expected_updated_at), name: text(data.name, 200, true), note: text(data.note ?? "", 2e3) };
  }
  throw new Error("지원하지 않는 작업입니다.");
}
export {
  id,
  writeInput,
  time,
  revision,
  text,
  known
};

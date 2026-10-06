import { actionBucket } from "../src/basic-work.mjs";
const el = (id) => document.getElementById(id);
const kindNames = { customer_reply: "고객 회신", hq_inquiry: "HQ 문의", hq_followup: "HQ Follow-up", customer_followup: "고객 Follow-up", other: "기타" };
const channelNames = {manual:"수동 입력",email:"이메일",phone:"전화",meeting:"미팅",wechat:"WeChat",kakao:"카카오톡",other:"기타"};
const statusNames = { new: "신규 문의", product_search: "제품 검색", need_hq_confirmation: "HQ 확인 필요", waiting_for_hq: "HQ 답변 대기", customer_reply_needed: "고객 회신 필요", waiting_for_customer: "고객 답변 대기", closed: "종료" };
function seoulInput(iso) {
  return iso ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(iso)).replace(" ", "T") : "";
}
const toIso = (value) => value ? (value.length === 16 ? value + ":00" : value) + "+09:00" : null;
function initWorkspace(api, dashboard, message) {
  let lookups = { customers: [], contacts: [], projects: [] }, selected = null, registerId = crypto.randomUUID(), actionId = crypto.randomUUID(), offset = 0, viewGeneration = 0, sessionGeneration = 0, currentDetailId = null;
  const option = (value, label) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    return o;
  };
  function options(id, rows, empty = "선택 안 함", preserve = true) {
    const select = el(id), old = select.value;
    select.replaceChildren(option("", empty), ...rows.map((r) => option(r.id, r.name)));
    if (preserve && rows.some((r) => r.id === old)) select.value = old;
  }
  function show(view) {
    viewGeneration++;
    for (const name of ["dashboard", "register", "history", "detail"]) el(name + "-view").hidden = name !== view;
  }
  function lookupOptions() {
    options("customer-select", lookups.customers, "신규 고객사 입력");
    linkedOptions();
    options("filter-customer", lookups.customers, "전체 고객사");
    filterProjects();
  }
  function linkedOptions() {
    const cid = el("customer-select").value;
    options("contact-select", lookups.contacts.filter((r) => r.customer_id === cid));
    options("project-select", lookups.projects.filter((r) => r.customer_id === cid));
    el("customer-name").disabled = Boolean(cid);
    if (cid) el("customer-name").value = "";
    for (const type of ["contact", "project"]) {
      const chosen = el(type + "-select").value;
      el(type + "-name").disabled = Boolean(chosen);
      if (chosen) el(type + "-name").value = "";
    }
  }
  function filterProjects() {
    const cid = el("filter-customer").value;
    options("filter-project", lookups.projects.filter((r) => !cid || r.customer_id === cid), "전체 프로젝트");
  }
  async function loadLookups() {
    const epoch = sessionGeneration;
    const data = await api("/api/lookups");
    if (epoch !== sessionGeneration) return;
    lookups = data;
    lookupOptions();
    if (data.truncated) throw new Error("고객 목록은 종류별 1,000개까지 표시됩니다. 누락된 항목은 신규 생성하지 말고 목록 범위 확장을 요청해주세요.");
  }
  async function busy(form, status, work) {
    const epoch = sessionGeneration;
    const buttons = [...form.querySelectorAll("button"), ...document.querySelectorAll(".nav-button,.mobile-nav button,#detail-reload,#dashboard-register")];
    const states = buttons.map((b) => b.disabled);
    buttons.forEach((b) => b.disabled = true);
    message(status, "저장하고 있습니다.");
    try {
      await work(epoch);
    } catch (e) {
      if (epoch === sessionGeneration) message(status, e.message, true);
    } finally {
      if (epoch === sessionGeneration) buttons.forEach((b, i) => {
        if (b.isConnected) b.disabled = states[i];
      });
    }
  }
  async function register() {
    show("register");
    el("inquiry-received").value ||= seoulInput((/* @__PURE__ */ new Date()).toISOString());
    try {
      await loadLookups();
      message("register-message", "");
    } catch (e) {
      message("register-message", e.message, true);
    }
  }
  async function history() {
    show("history");
    const active = viewGeneration;
    message("history-message", "문의를 불러오고 있습니다.");
    el("history-list").replaceChildren();
    el("history-prev").disabled = true;
    el("history-next").disabled = true;
    try {
      await loadLookups();
      if (active !== viewGeneration) return;
      const params = new URLSearchParams({ offset: String(offset) });
      for (const type of ["customer", "project"]) if (el("filter-" + type).value) params.set(type + "_id", el("filter-" + type).value);
      const data = await api("/api/inquiries?" + params);
      if (active !== viewGeneration) return;
      for (const inquiry of data.inquiries) {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.textContent = inquiry.title;
        button.addEventListener("click", () => open(inquiry.id));
        li.append(button);
        const small = document.createElement("small");
        small.textContent = (statusNames[inquiry.status] ?? inquiry.status) + " · " + (lookups.customers.find((c) => c.id === inquiry.customer_id)?.name ?? "고객사") + " · " + seoulInput(inquiry.received_at).replace("T", " ");
        li.append(small);
        el("history-list").append(li);
      }
      message("history-message", data.inquiries.length ? `${offset + 1}–${offset + data.inquiries.length}번째 문의 · 종료 포함` : "조건에 맞는 문의가 없습니다.");
      el("history-prev").disabled = offset === 0;
      el("history-next").disabled = !data.hasMore;
    } catch (e) {
      if (active === viewGeneration) message("history-message", e.message, true);
    }
  }
  function control(type, value, label, form) {
    const wrap = document.createElement("label");
    wrap.textContent = label;
    const input = document.createElement(type === "textarea" ? "textarea" : type === "select" ? "select" : "input");
    if (!["textarea", "select"].includes(type)) input.type = type;
    input.className = ["checkbox"].includes(type) ? "" : "form-control";
    if (type === "checkbox") input.checked = value;
    else input.value = value ?? "";
    wrap.append(input);
    form.append(wrap);
    return input;
  }
  function renderParties(i) {
    el("party-editors").replaceChildren();
    for (const type of ["customer", "contact", "project"]) {
      const row = lookups[type === "customer" ? "customers" : type === "contact" ? "contacts" : "projects"].find((r) => r.id === i[type + "_id"]);
      if (!row) continue;
      const form = document.createElement("form");
      form.className = "party-editor";
      const name = control("text", row.name, { customer: "고객사 이름", contact: "담당자 이름", project: "프로젝트 이름" }[type], form);
      name.required = true;
      name.maxLength = 200;
      const note = type === "customer" ? null : control("textarea", row.contact_note ?? row.description ?? "", "업무 메모", form);
      if (note) note.maxLength = 2e3;
      const button = document.createElement("button");
      button.className = "btn btn-outline-secondary";
      button.textContent = "이름 · 메모 저장";
      form.append(button);
      const status = document.createElement("p");
      status.id = "party-message-" + type;
      status.className = "message";
      status.setAttribute("role", "status");
      form.append(status);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        busy(form, status.id, async (epoch) => {
          await api("/api/parties", "PATCH", { kind: type, id: row.id, expected_updated_at: row.updated_at, name: name.value, note: note?.value ?? "" });
          if (epoch !== sessionGeneration) return;
          message(status.id, "저장했습니다.");
          await loadLookups();
          renderParties(i);
        });
      });
      el("party-editors").append(form);
    }
  }
  function renderActions(actions, closed) {
    el("detail-actions").replaceChildren();
    for (const action of actions) {
      const shell = document.createElement("details");
      shell.className = "action-editor";
      const summary = document.createElement("summary");
      const bucket = actionBucket(action, (/* @__PURE__ */ new Date()).toISOString());
      summary.textContent = `${kindNames[action.kind]} · ${action.description} · ${action.status === "completed" ? "완료" : action.status === "cancelled" ? "취소" : bucket === "today" ? "오늘 기한" : bucket === "overdue" ? "기한 지남" : "미완료"} · ${action.mandatory ? "필수" : "선택"}`;
      shell.append(summary);
      if (action.status !== "open" || closed) {
        const p = document.createElement("p");
        p.textContent = [action.due_date ? "기한 " + action.due_date : "기한 없음", action.waiting_target ? "대기 " + action.waiting_target + " / " + seoulInput(action.waiting_since) : "", action.completed_at ? "완료 " + seoulInput(action.completed_at) : "", action.cancel_reason ? "취소 사유: " + action.cancel_reason : "", closed && action.status === "open" ? "종료 시 남겨둔 선택 업무 (이력 보존)" : ""].filter(Boolean).join(" · ");
        shell.append(p);
      } else {
        const form = document.createElement("form");
        const kind = control("select", "", "종류", form);
        kind.replaceChildren(...Object.entries(kindNames).map(([key, label]) => option(key, label)));
        kind.value = action.kind;
        const description = control("textarea", action.description, "다음 행동 내용", form);
        description.required = true;
        description.maxLength = 2e3;
        const due = control("date", action.due_date, "기한 (서울 날짜)", form), mandatory = control("checkbox", action.mandatory, "필수 업무", form), target = control("text", action.waiting_target, "대기 대상", form), since = control("datetime-local", seoulInput(action.waiting_since), "대기 시작 (서울)", form);
        since.step = 1;
        target.maxLength = 200;
        const reason = control("textarea", "", "취소 사유 (취소 시 필수)", form);
        reason.maxLength = 2e3;
        for (const [state, label] of [["open", "변경 저장"], ["completed", "완료 처리"], ["cancelled", "사유를 남기고 취소"]]) {
          const b = document.createElement("button");
          b.className = "btn btn-outline-secondary";
          b.value = state;
          b.textContent = label;
          form.append(b);
        }
        const status = document.createElement("p");
        status.id = "edit-action-" + action.id;
        status.className = "message";
        status.setAttribute("role", "status");
        form.append(status);
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          const state = e.submitter?.value ?? "open";
          busy(form, status.id, async (epoch) => {
            await api("/api/actions/" + action.id, "PATCH", { revision: action.revision, kind: kind.value, description: description.value, due_date: due.value || null, mandatory: mandatory.checked, waiting_target: target.value, waiting_since: toIso(since.value), status: state, cancel_reason: reason.value });
            if (epoch === sessionGeneration) await open(action.inquiry_id);
          });
        });
        shell.append(form);
      }
      el("detail-actions").append(shell);
    }
    if (!actions.length) {
      const p = document.createElement("p");
      p.textContent = "아직 등록된 Action이 없습니다.";
      el("detail-actions").append(p);
    }
  }
  async function open(id) {
    if (currentDetailId !== id) {
      el("action-form").reset();
      actionId = crypto.randomUUID();
    }
    currentDetailId = id;
    show("detail");
    const active = viewGeneration;
    selected = null;
    el("detail-original").textContent = "";
    el("detail-actions").replaceChildren();
    el("party-editors").replaceChildren();
    for (const fid of ["detail-form", "action-form", "close-form"]) el(fid).hidden = true;
    message("detail-message", "문의를 불러오고 있습니다.");
    try {
      await loadLookups();
      const data = await api("/api/inquiries/" + id);
      if (active !== viewGeneration) return;
      selected = data.inquiry;
      const i = selected, closed = i.status === "closed";
      el("detail-heading").textContent = i.title;
      el("detail-original").textContent = i.original_text;
      el("detail-meta").textContent = [statusNames[i.status], lookups.customers.find((c) => c.id === i.customer_id)?.name, lookups.contacts.find((c) => c.id === i.contact_id)?.name, lookups.projects.find((c) => c.id === i.project_id)?.name, channelNames[i.channel]??i.channel, seoulInput(i.received_at).replace("T", " "), "서울 시각", i.closed_at ? "종료 " + seoulInput(i.closed_at).replace("T"," ") : ""].filter(Boolean).join(" · ");
      el("detail-title").value = i.title;
      el("detail-next").value = i.next_action;
      for (const fid of ["detail-form", "action-form", "close-form"]) el(fid).hidden = closed;
      renderActions(data.actions, closed);
      renderParties(i);
      const openActions = data.actions.filter((a) => a.status === "open");
      const required = openActions.filter((a) => a.mandatory).length;
      el("close-button").disabled = required > 0;
      el("close-resolved").checked = false;
      el("close-hint").textContent = `미완료 필수 ${required}개 · 선택 ${openActions.length - required}개. 필수 업무는 완료하거나 사유를 남겨 취소해야 합니다. 선택 업무는 종료 후 이력으로 보존됩니다.`;
      message("detail-message", closed ? "종료된 문의입니다. 원문과 Action 이력을 보존합니다." : "원문을 보존하며 다음 행동을 관리합니다.");
    } catch (e) {
      if (active === viewGeneration) message("detail-message", e.message, true);
    }
  }
  for (const name of ["nav", "mobile"]) {
    el(name + "-dashboard").addEventListener("click", () => {
      show("dashboard");
      dashboard();
    });
    el(name + "-register").addEventListener("click", register);
    el(name + "-history").addEventListener("click", () => {
      offset = 0;
      history();
    });
  }
  el("dashboard-register").addEventListener("click", register);
  el("register-reset").addEventListener("click", () => {
    el("inquiry-form").reset();
    registerId = crypto.randomUUID();
    el("inquiry-received").value = seoulInput(new Date().toISOString());
    linkedOptions();
    message("register-message", "새 문의 입력을 시작합니다.");
  });
  el("action-reset").addEventListener("click", () => {
    el("action-form").reset();
    actionId = crypto.randomUUID();
    message("action-message", "새 Action 입력을 시작합니다.");
  });
  el("customer-select").addEventListener("change", linkedOptions);
  for (const type of ["contact", "project"]) el(type + "-select").addEventListener("change", linkedOptions);
  el("filter-customer").addEventListener("change", filterProjects);
  el("lookup-reload").addEventListener("click", async () => {
    try {
      await loadLookups();
      message("register-message", "고객 목록을 갱신했습니다. 입력은 유지했습니다.");
    } catch (e) {
      message("register-message", e.message, true);
    }
  });
  el("history-search").addEventListener("click", () => {
    offset = 0;
    history();
  });
  el("history-prev").addEventListener("click", () => {
    offset = Math.max(0, offset - 100);
    history();
  });
  el("history-next").addEventListener("click", () => {
    offset += 100;
    history();
  });
  el("detail-reload").addEventListener("click", () => {
    if (currentDetailId) open(currentDetailId);
  });
  el("inquiry-form").addEventListener("submit", (e) => {
    e.preventDefault();
    busy(e.currentTarget, "register-message", async (epoch) => {
      const body = { id: registerId, title: el("inquiry-title").value, channel: el("inquiry-channel").value, received_at: toIso(el("inquiry-received").value), original_text: el("inquiry-original").value, next_action: el("inquiry-next").value };
      for (const type of ["customer", "contact", "project"]) {
        body[type + "_id"] = el(type + "-select").value || null;
        body[type + "_name"] = el(type + "-name").value;
      }
      const data = await api("/api/inquiries", "POST", body);
      if (epoch !== sessionGeneration) return;
      el("inquiry-form").reset();
      registerId = crypto.randomUUID();
      await open(data.result);
    });
  });
  el("detail-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!selected) return;
    const i = selected;
    busy(e.currentTarget, "detail-message", async (epoch) => {
      await api("/api/inquiries/" + i.id, "PATCH", { revision: i.revision, title: el("detail-title").value, next_action: el("detail-next").value });
      if (epoch === sessionGeneration) await open(i.id);
    });
  });
  el("action-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!selected) return;
    const iid = selected.id;
    busy(e.currentTarget, "action-message", async (epoch) => {
      await api("/api/inquiries/" + iid + "/actions", "POST", { id: actionId, kind: el("action-kind").value, description: el("action-description").value, due_date: el("action-due").value || null, mandatory: el("action-mandatory").checked, waiting_target: el("action-target").value, waiting_since: toIso(el("action-since").value) });
      if (epoch !== sessionGeneration) return;
      el("action-form").reset();
      actionId = crypto.randomUUID();
      message("action-message", "");
      await open(iid);
    });
  });
  el("close-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!selected) return;
    const i = selected;
    busy(e.currentTarget, "close-message", async (epoch) => {
      await api("/api/inquiries/" + i.id + "/close", "POST", { revision: i.revision, resolved: el("close-resolved").checked });
      if (epoch === sessionGeneration) await open(i.id);
    });
  });
  return { open, reset() {
    sessionGeneration++;
    viewGeneration++;
    selected = null;
    currentDetailId = null;
    lookups = { customers: [], contacts: [], projects: [] };
    registerId = crypto.randomUUID();
    actionId = crypto.randomUUID();
    offset = 0;
    for (const button of document.querySelectorAll("#workspace button")) button.disabled = false;
    for (const id of ["history-prev", "history-next", "close-button"]) el(id).disabled = true;
    for (const form of document.querySelectorAll("#workspace form")) form.reset();
    for (const field of document.querySelectorAll("#workspace input:not([type=checkbox]),#workspace textarea")) field.value = "";
    for (const list of ["history-list", "detail-actions", "party-editors"]) el(list).replaceChildren();
    for (const id of ["detail-original", "detail-heading", "detail-meta"]) el(id).textContent = "";
    for (const id of ["register-message", "detail-message", "action-message", "close-message", "history-message"]) message(id, "");
    lookupOptions();
    show("dashboard");
  } };
}
export {
  initWorkspace,
  seoulInput,
  statusNames
};

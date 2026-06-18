"""End-to-end smoke tests — run entirely in deterministic mock mode (no keys)."""
import os

os.environ.setdefault("FORCE_MOCK", "1")  # must precede app import
os.environ["DEMO_SEED"] = "0"  # run tests against a clean store (no demo seed)

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)


def test_health_is_mock():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["providers"]["llm"] == "mock"


def test_log_inspection_creates_work_order():
    r = client.post("/voice", json={
        "transcript": "inverter seven string two low output, severity high, "
                      "I isolated the string",
        "session_id": "s-log",
    })
    body = r.json()
    assert body["intent"] == "LOG_INSPECTION"
    assert body["work_order"]["work_order_id"].startswith("WO-")
    assert body["work_order"]["asset_id"] == "INV-07"
    assert body["work_order"]["severity"] == "high"
    assert body["escalated"] is True  # high severity -> alert
    assert not body["needs_clarification"]


def test_missing_severity_triggers_clarify():
    r = client.post("/voice", json={
        "transcript": "inverter eight is offline",
        "session_id": "s-clarify",
    })
    body = r.json()
    assert body["needs_clarification"] is True
    assert "severe" in body["reply"].lower()  # "How severe is it — low/medium/..."


def test_query_uses_graph_and_rag():
    r = client.post("/voice", json={
        "transcript": "what faults has inverter seven had and how were they fixed?",
        "session_id": "s-query",
    })
    body = r.json()
    assert body["intent"] == "QUERY"
    assert body["reply"]
    assert any("graph" in s.lower() or "manual" in s.lower()
               for s in body["answer_sources"])
    assert body["latency_ms"] >= 0


def test_escalation_path():
    r = client.post("/voice", json={
        "transcript": "emergency, smoke and sparking from inverter twelve",
        "session_id": "s-esc",
    })
    body = r.json()
    assert body["intent"] == "ESCALATE"
    assert body["escalated"] is True
    assert body["work_order"]["severity"] == "critical"
    assert client.get("/alerts").json()  # an alert exists


def test_close_that_one_uses_session_memory():
    sess = "s-memory"
    create = client.post("/voice", json={
        "transcript": "inverter seven low output severity medium",
        "session_id": sess,
    }).json()
    wo_id = create["work_order"]["work_order_id"]

    close = client.post("/voice", json={
        "transcript": "close that one, parts ordered",
        "session_id": sess,
    }).json()
    assert close["intent"] == "WORK_ORDER_ACTION"
    assert wo_id in close["reply"]
    assert "closed" in close["reply"].lower()

    fetched = client.get(f"/work_orders/{wo_id}").json()
    assert fetched["status"] == "closed"


def test_offline_sync_batch():
    r = client.post("/sync", json={"items": [
        {"transcript": "inverter seven low output severity high",
         "client_id": "c1", "session_id": "s-sync"},
        {"transcript": "combiner box B blown fuse severity medium",
         "client_id": "c2", "session_id": "s-sync"},
    ]})
    body = r.json()
    assert body["processed"] == 2
    assert {res["client_id"] for res in body["results"]} == {"c1", "c2"}


def test_dashboard_endpoints_populated():
    assert client.get("/work_orders").json()
    assert isinstance(client.get("/activity").json(), list)


def test_severity_homophone_does_not_force_clarify():
    # Browser STT often hears "low" as "law"; an explicit "severity law"
    # should fuzzy-resolve to low and log the WO instead of asking again.
    # (Includes a fault so all required fields are present — fault_code is
    # required, so the only thing under test is the severity homophone.)
    r = client.post("/voice", json={
        "transcript": "inverter nine offline severity law",
        "session_id": "s-homophone",
    })
    body = r.json()
    assert body["needs_clarification"] is False
    assert body["work_order"]["severity"] == "low"

# -*- coding: utf-8 -*-
"""
숨비 지킴이 실행 서버 (파이썬만 있으면 됨, 추가 설치 없음)

하는 일
 1) 숨비지킴이.html 을 http://localhost:8000 으로 열어줌 (마이크로비트 USB 연결이 되는 주소)
 2) 공공데이터포털(수온, 기상청)과 Gemini 호출을 대신 해줌
    - 브라우저에서 직접 부르면 막히는 문제(CORS)를 피하고
    - API 키가 웹페이지에 드러나지 않게 함

실행: 이 파일을 더블클릭하거나, 터미널에서  python server.py
종료: 창을 닫거나 Ctrl+C
"""
import json, os, sys, threading, webbrowser
import urllib.request, urllib.parse, urllib.error
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

# ===== 키 설정 =====
# 공공데이터포털 "일반 인증키(Encoding)" 를 그대로 붙여넣기
DATA_GO_KEY = os.environ.get("DATA_GO_KEY", "")  # 여기에 직접 넣어도 됨 (GitHub에 올릴 땐 비워두기)
# Google AI Studio 에서 받은 Gemini API 키
GEMINI_KEY = os.environ.get("GEMINI_KEY", "")
PORT = 8000
PAGE = "index.html"
# 이 서버가 대신 불러줄 수 있는 공공데이터 서비스 (다른 주소는 거부)
ALLOWED = ("1192136/surveyWaterTemp/", "1360000/MidFcstInfoService/")

HERE = os.path.dirname(os.path.abspath(__file__))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=HERE, **kw)

    def log_message(self, fmt, *args):
        sys.stdout.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def send_json(self, code, data, raw=False):
        body = data if raw else json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def fetch(self, req):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()
        except Exception as e:
            return 502, json.dumps({"error": {"message": "서버에서 외부 API에 연결하지 못함: %s" % e}}, ensure_ascii=False).encode("utf-8")

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path in ("/", "/index.html"):
            self.send_response(302)
            self.send_header("Location", "/" + urllib.parse.quote(PAGE))
            self.end_headers()
            return
        if u.path == "/api/health":
            return self.send_json(200, {"ok": True, "datago": bool(DATA_GO_KEY), "gemini": bool(GEMINI_KEY)})
        if u.path == "/api/datago":
            q = urllib.parse.parse_qs(u.query, keep_blank_values=True)
            path = q.pop("path", [""])[0]
            if not path.startswith(ALLOWED):
                return self.send_json(400, {"error": "허용되지 않은 API 경로"})
            params = urllib.parse.urlencode({k: v[0] for k, v in q.items()})
            # Encoding 키는 이미 인코딩돼 있으므로 그대로 붙임
            url = "https://apis.data.go.kr/%s?serviceKey=%s&%s" % (path, DATA_GO_KEY, params)
            code, body = self.fetch(urllib.request.Request(url, headers={"Accept": "application/json"}))
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8" if body[:1] in (b"{", b"[") else "text/plain; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if u.path != "/api/gemini":
            return self.send_json(404, {"error": "없는 주소"})
        if not GEMINI_KEY:
            return self.send_json(400, {"error": {"message": "server.py 에 GEMINI_KEY 가 없습니다"}})
        model = urllib.parse.parse_qs(u.query).get("model", ["gemini-flash-latest"])[0]
        model = "".join(c for c in model if c.isalnum() or c in "-._")
        data = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        req = urllib.request.Request(
            "https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent" % model,
            data=data, method="POST",
            headers={"Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY})
        code, body = self.fetch(req)
        self.send_json(code, body, raw=True)


if __name__ == "__main__":
    url = "http://localhost:%d/" % PORT
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("숨비 지킴이 서버 실행 중:", url)
    print("크롬이나 엣지에서 위 주소를 여세요. 끄려면 이 창을 닫으세요.")
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass

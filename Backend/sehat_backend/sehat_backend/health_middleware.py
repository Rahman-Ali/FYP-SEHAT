import json
from django.http import HttpResponse


class HealthCheckMiddleware:
    """Lightweight health check middleware that intercepts /healthz and /readyz.

    Placed first in MIDDLEWARE so it responds before SecurityMiddleware,
    avoiding ALLOWED_HOSTS or SSL-redirect issues for Render's health prober.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path_info

        if path == "/healthz" or path == "/healthz/":
            return HttpResponse(
                json.dumps({"status": "ok"}),
                content_type="application/json",
                status=200,
            )

        if path == "/readyz" or path == "/readyz/":
            try:
                from chat.warmup import get_warmup_state
                state = get_warmup_state()
            except Exception:
                state = "idle"

            if state == "ready":
                return HttpResponse(
                    json.dumps({"status": "ready"}),
                    content_type="application/json",
                    status=200,
                )
            else:
                return HttpResponse(
                    json.dumps({"state": state}),
                    content_type="application/json",
                    status=503,
                )

        return self.get_response(request)

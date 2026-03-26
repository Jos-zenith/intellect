from locust import HttpUser, task, between


class AcademicTeamSpaceUser(HttpUser):
    wait_time = between(0.1, 0.8)

    @task(3)
    def health(self) -> None:
        self.client.get("/api/health")

    @task(1)
    def health_detailed(self) -> None:
        self.client.get("/api/health/detailed")

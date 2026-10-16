# Team 1 on EKS: how this k8s/ bundle is wired to our application

The bundle came from the generic Cloud Deployment kit. Its `DEPLOYMENT-ETP-TESTED.md` is another
team's filled-in runbook (their cluster, RDS host, load balancers and image tag), so its values do
not apply here. This file records what our application actually needs and why each part is set
the way it is.

## Where the settings come from

| What | File | Becomes | Why |
|---|---|---|---|
| Service addresses (ports, hosts, URLs) | `Application/Config/services.env`, copied to `base/generated/services.env` | ConfigMap `etp-shared-config`, mounted at `/config/services.env` | Every service reads this file (`SERVICES_CONFIG_FILE`). Kustomize cannot read files outside `k8s/`, so it is copied in. |
| Cluster overrides | `base/config.env` | ConfigMap `etp-config` (env vars) | An env var beats `services.env`: Kafka is `kafka:29092` in the cluster, not `localhost`. |
| Secrets | `base/secrets.env` (git-ignored) | Secret `etp-secrets-env` (env vars) | Names are the ones the code reads: `POSTGRES_*`, `JWT_SECRET`, `FAUXNANCE_API_KEY`, `AUTH_PRIVATE_KEY`, `LLM_API_KEY`, `SMTP_*`. Template: `secrets.env.example`. |
| Public addresses | `overlays/four-lb/urls.env` | ConfigMap `etp-urls` | Reference only; the app does not depend on them. |

The TrustMe vault is not used in the cluster (no key file in the pods): every service falls back to
the environment variables above.

## Things that are easy to get wrong

- **`enableServiceLinks: false`** on every app pod. Without it Kubernetes adds
  `<SERVICE>_PORT=tcp://<ip>:<port>` for every Service, and `FRONTEND_PORT` / `AUTH_SERVICE_PORT`
  collide with `services.env`: the services read `tcp://...` as a port number and crash.
- **order-service health is `/actuator/health`**, not `/health`.
- **The browser only talks to the frontend.** nginx in the frontend pod forwards `/_auth/...` to
  auth-service and `/_order/...` to order-service inside the cluster (same origin: no CORS, cookies
  work). Kubernetes needs two settings Docker does not (see `base/frontend.yaml`):
  `FRONTEND_PROXY_RESOLVER=kube-dns.kube-system.svc.cluster.local` (Docker's DNS is 127.0.0.11) and
  full service names in `FRONTEND_PROXY_*_TARGET` (nginx ignores the pod's search domains).
- **Workloads run in the `default` namespace** (the `etp` namespace is created but unused). The
  frontend's proxy targets contain `default`; change both if the namespace changes.
- **One image tag per build**, never a tag that was not pushed. `base/kustomization.yaml` names it.

## Redeploying after a code change

```bash
cd /home/ubuntu/Documents/YRV/Chennai-capstone-SE3-Team1
TAG=$(git rev-parse --short HEAD)-eks1          # bump the suffix for a rebuild of the same commit
REG=434661699513.dkr.ecr.ap-south-1.amazonaws.com

# frontend build needs Contracts and Config (wiped from /tmp on reboot)
rm -rf /tmp/fe-extra && mkdir -p /tmp/fe-extra && cp -r Application/Contracts Application/Config /tmp/fe-extra/

for s in auth-service order-service executor-service frontend; do docker compose build $s; done
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin $REG
for s in auth-service order-service executor-service frontend; do
  docker tag $s:latest $REG/etp-$s:$TAG && docker push $REG/etp-$s:$TAG
done

sed -i "s/newTag: .*/newTag: $TAG/" k8s/base/kustomization.yaml
cp Application/Config/services.env k8s/base/generated/services.env    # if services.env changed

kubectl apply --dry-run=server -k k8s/overlays/four-lb
kubectl apply -k k8s/overlays/four-lb
for d in auth-service order-service executor-service frontend; do kubectl rollout status deployment/$d --timeout=300s; done
```

A secret change (`secrets.env`) creates a new Secret name, so the next `kubectl apply -k` restarts
the pods by itself.

## Checking it

```bash
kubectl get pods                                   # all Running, READY 1/1
kubectl logs deploy/order-service --tail=100       # likewise auth-service, executor-service, frontend
FE=$(kubectl get svc frontend -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
curl -s http://$FE/_auth/health/ready              # database and kafka "up"
curl -s http://$FE/_order/actuator/health          # {"status":"UP"...}
```

## Database connections

Do not run the Docker Compose stack and the EKS stack against RDS at the same time: together they
can use up the small instance's connection slots. The RDS security group should allow port 5432
only from the cluster's NAT gateway address and from the RDS VPC, not from `0.0.0.0/0`.

## Pausing and resuming

```bash
bash k8s/pause.sh     # all app pods and Kafka to 0; settings, data and load balancers stay
bash k8s/resume.sh    # Kafka first, then the apps; prints the site address when it answers
```

Kafka must be running before order-service and executor-service can start. Both have a
`wait-for-kafka` init container, so if Kafka is down they wait at `Init:0/1` (instead of crashing in a
loop) and start on their own once it is up. If they sit at `Init:0/1`, Kafka is not running:
`kubectl scale statefulset kafka --replicas=1`.

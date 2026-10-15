#!/usr/bin/env bash
# Starts the paused stack in the right order: Kafka first, then the apps. Prints the site when it answers.
#   bash k8s/resume.sh          (Application/k8s/resume.sh where the bundle lives there)
set -e
kubectl scale statefulset kafka --replicas=1
echo "waiting for Kafka…"; kubectl wait --for=condition=ready pod/kafka-0 --timeout=600s
kubectl scale deployment auth-service order-service executor-service frontend --replicas=1
for d in auth-service order-service executor-service frontend; do kubectl rollout status deployment/$d --timeout=600s; done
FE="http://$(kubectl get svc frontend -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')"
until [ "$(curl -s -o /dev/null -w '%{http_code}' "$FE/")" = 200 ]; do echo "waiting for the site…"; sleep 10; done
kubectl get pods
echo "Ready: $FE"

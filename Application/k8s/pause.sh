#!/usr/bin/env bash
# Stops every app pod and Kafka (settings, data and load balancers stay). Undo with resume.sh.
set -e
kubectl scale deployment auth-service order-service executor-service frontend --replicas=0
kubectl scale statefulset kafka --replicas=0
kubectl get deploy,statefulset

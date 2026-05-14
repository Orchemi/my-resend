#!/bin/bash

# MyResend Kubernetes Update Script
# Update deployment with new image

set -e

# Generate timestamp for unique image tag
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
IMAGE_TAG="your-registry.example.com/my-resend:${TIMESTAMP}"

echo "🔄 Updating MyResend deployment..."

# Build and push new image
echo "📦 Building Docker image with tag: ${IMAGE_TAG}"
docker build --platform linux/amd64 -t ${IMAGE_TAG} .
docker tag ${IMAGE_TAG} your-registry.example.com/my-resend:latest

echo "🔄 Pushing to Digital Ocean Container Registry..."
docker push ${IMAGE_TAG}
docker push your-registry.example.com/my-resend:latest

# Update deployment
echo "🚀 Updating Kubernetes deployment..."
kubectl set image deployment/my-resend my-resend=${IMAGE_TAG} -n my-resend

echo "⏳ Waiting for rollout to complete..."
kubectl rollout status deployment/my-resend -n my-resend --timeout=300s

echo "🔍 Deployment status..."
kubectl get pods -n my-resend

echo "✅ MyResend update completed!"
#!/bin/bash

# MyResend Kubernetes Deployment Script
# Deploy to Digital Ocean Kubernetes

set -e

echo "🚀 Deploying MyResend to Kubernetes..."

# Build and push Docker image
echo "📦 Building Docker image..."
docker build --platform linux/amd64 -t your-registry.example.com/my-resend:latest .

echo "🔄 Pushing to Digital Ocean Container Registry..."
docker push your-registry.example.com/my-resend:latest

# Apply Kubernetes manifests
echo "🔧 Applying Kubernetes manifests..."

# Create namespace first
kubectl apply -f k8s/namespace.yaml

# Apply secrets (create from template first if needed)
if [ ! -f "k8s/secret.yaml" ]; then
  echo "⚠️  secret.yaml not found. Copy secret.template.yaml to secret.yaml and update with your values."
  echo "   cp k8s/secret.template.yaml k8s/secret.yaml"
  exit 1
fi
kubectl apply -f k8s/secret.yaml

# Apply application resources
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml
kubectl apply -f k8s/hpa.yaml

echo "⏳ Waiting for deployment to be ready..."
kubectl rollout status deployment/my-resend -n my-resend --timeout=300s

echo "🔍 Getting deployment status..."
kubectl get pods -n my-resend
kubectl get services -n my-resend
kubectl get ingress -n my-resend

echo "✅ MyResend deployment completed!"
echo "🌐 Application will be available at: https://www.example.com"
echo ""
echo "📋 Useful commands:"
echo "  kubectl get pods -n my-resend"
echo "  kubectl logs -f deployment/my-resend -n my-resend"
echo "  kubectl describe ingress my-resend-ingress -n my-resend"
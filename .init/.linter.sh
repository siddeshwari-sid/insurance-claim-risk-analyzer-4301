#!/bin/bash
cd /home/kavia/workspace/code-generation/insurance-claim-risk-analyzer-4301/fraud_detection_backend
npm run lint
LINT_EXIT_CODE=$?
if [ $LINT_EXIT_CODE -ne 0 ]; then
  exit 1
fi


FROM node:20-slim
WORKDIR /app
COPY phase1.test.mjs phase2.test.mjs phase3.test.mjs phase4.test.mjs lib.mjs run-all.mjs ./
# PHASE env var (1..4 or 'all') selects which phase test(s) to run.
ENV PHASE=all
CMD ["node", "run-all.mjs"]

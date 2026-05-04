import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

export interface InitOtelOptions {
  /** OTLP gRPC endpoint. Defaults to `OTEL_EXPORTER_OTLP_ENDPOINT` or `http://otel-collector:4317`. */
  endpoint?: string;
}

/**
 * Initialise the OpenTelemetry NodeSDK with HTTP auto-instrumentations
 * and an OTLP gRPC trace exporter pointing at the otel-collector.
 *
 * Call once, BEFORE importing Fastify and other instrumented libs, so
 * auto-instrumentations can hook them at module-load time.
 *
 * Returns the NodeSDK instance — wire `await sdk.shutdown()` to your
 * SIGTERM handler so in-flight spans flush cleanly on container stop.
 *
 * Set `OTEL_DISABLED=true` to short-circuit (returns null). Useful in
 * tests and local-dev workflows where running otel-collector is
 * unnecessary noise.
 */
export function initOtel(serviceName: string, options: InitOtelOptions = {}): NodeSDK | null {
  if (process.env['OTEL_DISABLED'] === 'true') {
    return null;
  }

  const endpoint =
    options.endpoint ??
    process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ??
    'http://otel-collector:4317';

  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
    }),
    traceExporter: new OTLPTraceExporter({ url: endpoint }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable filesystem instrumentation — too noisy and not actionable
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();
  return sdk;
}

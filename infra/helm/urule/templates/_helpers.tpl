{{/*
Common labels applied to every resource. Following Helm best-practice
keys so kubectl/k9s/etc. group correctly.
*/}}
{{- define "urule.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/part-of: urule
{{- end -}}

{{/*
Per-service labels — merge with shared labels at usage sites.
Pass `(dict "name" $name "ctx" $)`.
*/}}
{{- define "urule.serviceLabels" -}}
{{- $name := .name -}}
app.kubernetes.io/name: {{ $name }}
app.kubernetes.io/component: {{ $name }}
{{- end -}}

{{/*
Resolved image reference. Pass `(dict "image" $svc.image "ctx" $)`.
*/}}
{{- define "urule.image" -}}
{{- $registry := .ctx.Values.global.imageRegistry | default "ghcr.io/urule-ai" -}}
{{- $tag := .ctx.Values.global.imageTag | default "latest" -}}
{{- printf "%s/%s:%s" $registry .image $tag -}}
{{- end -}}

{{/*
ServiceAccount name — generated unless overridden.
*/}}
{{- define "urule.serviceAccountName" -}}
{{- if .Values.global.serviceAccount.create -}}
{{- default (printf "%s-urule" .Release.Name) .Values.global.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.global.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/*
DATABASE_URL helper. Combines `global.databaseUrlBase` with the
service's `databaseName`. Returns empty string when no databaseName
is set so services without a Postgres schema (state, approvals,
governance, langgraph-adapter, office-ui) don't get a stray env var.
*/}}
{{- define "urule.databaseUrl" -}}
{{- $base := .ctx.Values.global.databaseUrlBase -}}
{{- if .databaseName -}}
{{- printf "%s/%s" $base .databaseName -}}
{{- end -}}
{{- end -}}

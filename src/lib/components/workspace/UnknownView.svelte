<script lang="ts">
  import FileQuestionMarkIcon from '@lucide/svelte/icons/file-question-mark'
  import type { ViewProps } from '$lib/workspace/view-registry'
  import { t } from '$lib/i18n/t.svelte'

  let { tab }: ViewProps = $props()
</script>

<!--
  The fallback for a tab whose kind has no registered view. It keeps the tab
  (and its persisted URI) intact so nothing is lost when a newer build — or a
  later phase — brings the view back.
-->
<div class="flex h-full items-center justify-center p-8">
  <div class="flex max-w-sm flex-col items-center text-center">
    <div
      class="bg-muted text-muted-foreground mb-4 flex size-12 items-center justify-center rounded-xl"
      aria-hidden="true"
    >
      <FileQuestionMarkIcon class="size-6" />
    </div>
    <h2 class="text-base font-semibold tracking-tight">
      {t('workspace.unknownView.title')}
    </h2>
    <p class="text-muted-foreground mt-1.5 text-sm text-balance">
      {t('workspace.unknownView.description', { title: tab.title })}
    </p>
    <code
      class="bg-muted text-muted-foreground mt-4 max-w-full truncate rounded px-1.5 py-0.5 font-mono text-xs"
      title={tab.uri}
    >
      {tab.uri}
    </code>
  </div>
</div>

from pathlib import Path

source = Path(".github/controller/issue117_patch.py").read_text()
old = '''text = replace_once(
    text,
    ''' + "'''" + '''      providerCallsAttempted: extractionResult.providerCallsAttempted,
      providerCallsSucceeded: extractionResult.providerCallsSucceeded,
      creditsUsed: extractionResult.creditsUsed,'''+ "'''" + ''',
    ''' + "'''" + '''      providerCallsAttempted: extractionResult.providerCallsAttempted,
      providerCallsSucceeded: extractionResult.providerCallsSucceeded,
      provider: extractionResult.provider,
      model: extractionResult.model,
      creditsUsed: extractionResult.creditsUsed,'''+ "'''" + ''',
    "daily result provider values",
)
'''
new = '''result_marker = "  const result: DailyPipelineResult = {"
result_prefix, result_suffix = text.split(result_marker, 1)
result_suffix = replace_once(
    result_suffix,
    ''' + "'''" + '''      providerCallsAttempted: extractionResult.providerCallsAttempted,
      providerCallsSucceeded: extractionResult.providerCallsSucceeded,
      creditsUsed: extractionResult.creditsUsed,'''+ "'''" + ''',
    ''' + "'''" + '''      providerCallsAttempted: extractionResult.providerCallsAttempted,
      providerCallsSucceeded: extractionResult.providerCallsSucceeded,
      provider: extractionResult.provider,
      model: extractionResult.model,
      creditsUsed: extractionResult.creditsUsed,'''+ "'''" + ''',
    "daily result provider values",
)
text = result_prefix + result_marker + result_suffix
'''
if source.count(old) != 1:
    raise SystemExit(f"controller patch correction: expected 1 match, found {source.count(old)}")
corrected = source.replace(old, new, 1)
exec(compile(corrected, "issue117_patch_corrected.py", "exec"), {"__name__": "__main__"})

# Authored synthetic evaluation inputs

This is a separate, small authored evaluation set, not a real-news sample. All organizations and events are fictional. These inputs support a controlled comparison of procedures, not claims about natural error prevalence or runtime generation quality.

Use `detector_inputs.jsonl` and `detector_instruction.txt` only as detector inputs. Each row supplies an opaque item ID, language, full source, fixed question, and candidate. The private authoring records contain the reference answers and validation materials.

Run both procedures on exactly these same rows with the same declared budget and native runtime configuration. Record all settings, calls, exclusions and results. Do not run until the independent pre-test validity audit has accepted the cases. The author did not launch detectors.

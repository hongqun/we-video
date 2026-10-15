# RVE Remotion Templates attribution

The template catalogue in `registry.ts` is derived from
https://github.com/reactvideoeditor/remotion-templates (commit
`6209b724798e48ff395f8df1a6fa2d26082372b5`, downloaded on 2026-08-04).  The
upstream README states that its 81 template components are
available under the MIT License.  This project keeps the catalogue and adapts
the visual language/props locally; it does not ship or depend on the upstream
demo application.

Template names and categories are retained so an editor can trace a selected
visual back to its upstream source.

## RemotionUI recipes

The local `rve/timeline-steps` treatment and the existing list motion were
adapted after reviewing RemotionUI `timeline-steps` and `feature-list` from the
default registry (`remotion-ui` package version `0.8.0`, reviewed on
2026-08-14). RemotionUI is MIT licensed and published at
https://github.com/riaz37/remotion-ui. The implementation remains local,
uses the Tech123 Chinese portrait layout and palette, and adds no runtime
dependency on RemotionUI or its Google Fonts helpers.

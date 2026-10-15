import assert from "node:assert/strict";
import {videoDownloadAsciiFallback, videoDownloadFilename} from "@/lib/filename";

assert.equal(videoDownloadFilename("How LLMs use APIs", "tech123-tech-minute-en"), "How LLMs use APIs.mp4");
assert.equal(videoDownloadAsciiFallback("How LLMs use APIs", "tech123-tech-minute-en"), "How LLMs use APIs.mp4");
assert.equal(videoDownloadAsciiFallback("智能体和工作流", "tech123-video"), "tech123-video.mp4");

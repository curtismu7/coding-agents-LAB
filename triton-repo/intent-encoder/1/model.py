# A deterministic CPU stand-in "encoder": a 384-dim hashed bag-of-character-trigrams vector.
# NOT a trained model - it turns text into a stable, bounded vector so the KServe v2 wire
# shape can be exercised end to end. Replacing it with a real model is a config change only.
import hashlib
import struct

import numpy as np
import triton_python_backend_utils as pb_utils


class TritonPythonModel:
    def initialize(self, args):
        self.dim = 384

    def execute(self, requests):
        responses = []
        for request in requests:
            texts = pb_utils.get_input_tensor_by_name(request, "TEXT").as_numpy()
            vecs = np.zeros((texts.shape[0], self.dim), dtype=np.float32)
            for i, raw in enumerate(texts):
                text = raw[0].decode("utf-8") if isinstance(raw[0], bytes) else str(raw[0])
                vecs[i] = self._embed(text)
            out = pb_utils.Tensor("EMBEDDING", vecs)
            responses.append(pb_utils.InferenceResponse(output_tensors=[out]))
        return responses

    def _embed(self, text):
        v = np.zeros(self.dim, dtype=np.float32)
        t = f" {text.lower().strip()} "
        for i in range(len(t) - 2):
            tri = t[i:i + 3]
            h = hashlib.md5(tri.encode("utf-8")).digest()
            (idx,) = struct.unpack("<I", h[:4])
            v[idx % self.dim] += 1.0 if (h[4] & 1) else -1.0
        n = np.linalg.norm(v)
        return v / n if n > 0 else v

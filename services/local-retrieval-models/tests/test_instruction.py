import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import Mock

os.environ["LOCAL_MODEL_INTERNAL_TOKEN"] = "test-only-" * 8
os.environ["LOCAL_MODEL_ALLOW_CPU"] = "true"
os.environ["LOCAL_MODEL_FAKE_MODE"] = "false"
spec = importlib.util.spec_from_file_location(
    "model_service", Path(__file__).parents[1] / "src/local_retrieval_models/server.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class InstructionIsolationTest(unittest.TestCase):
    def test_cached_model_receives_each_requests_instruction(self):
        runtime = module.ModelRuntime()
        model = Mock()
        model.predict.return_value = [0.5]
        runtime._reranker_model = model
        runtime.rerank("topic", ["record"], "Judge topical relevance only.")
        runtime.rerank("topic", ["record"], "Judge explicit semantic exclusions.")
        self.assertEqual(
            [call.kwargs["prompt"] for call in model.predict.call_args_list],
            ["Judge topical relevance only.", "Judge explicit semantic exclusions."],
        )

if __name__ == "__main__":
    unittest.main()

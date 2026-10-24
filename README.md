
## DIYA — Derma.In.Your.Area

This is a static, browser-based PWA. It starts at Login. Patients enter their
name, phone number, and account password in that order, then the dashboard
welcomes them by name. First-time users can create a local account. Analysis
results include general educational next-step information for each of the
seven model categories. A displayed category can be wrong, and model scores
are not calibrated clinical probabilities. Model output is not a diagnosis
or a personalized treatment recommendation.

There is no server, cloud account, or cross-device sync. Account profiles and
analysis history are encrypted in browser-local IndexedDB with a password-
derived AES-GCM key. Passwords are not stored; losing the password means the
encrypted data cannot be recovered. Keep the password private, lock the
account when finished, and use a trusted device. Clearing browser data removes
the account and history. Reports can be printed or saved as PDF through the
browser print dialog.

Records saved by older app versions have no account owner. On first account
creation, the app requires confirmation before encrypting and importing them;
they can instead be deleted as unclaimed records.

The reference model can assign high scores to unsupported images. The
experimental rejection model was also tested and performed poorly. Therefore,
the website labels the top-scoring class as a research model output and
displays a medical safety notice. The model cannot reliably reject
unsupported images. Do not use the output to make medical decisions.

The app loads the developed model from `trained_model_7class`. The original
reference model is retained as a research asset. The app supports seven
categories: actinic keratoses, basal cell carcinoma, benign keratosis-like
lesions, dermatofibroma, melanoma, melanocytic nevi, and vascular lesions.

The reference model's seven classes are described in this paper:

The HAM10000 Dataset: A Large Collection of Multi-Source Dermatoscopic Images of Common Pigmented Skin Lesions<br>
https://arxiv.org/abs/1803.10417


The entire model building and training process is described in this Kaggle kernel:<br>
https://www.kaggle.com/vbookshelf/skin-lesion-analyzer-tensorflow-js-web-app

The original model training process is described in the Jupyter notebook. All the JavaScript, CSS and HTML files are also available here. The included browser model is the original 7-class HAM10000 model, covering actinic keratoses, basal cell carcinoma, benign keratosis-like lesions, dermatofibroma, melanoma, melanocytic nevi, and vascular lesions. The current website does not display model predictions. Other images could still be incorrectly ranked as one of these classes.

## Optional unsupported-image rejection model

The optional rejection model remains unavailable because it failed validation.
The app does not load it. The
optional training script uses an internal eighth output, `Other / unsupported`,
trained from the seven additional archive categories. The app would map that
output to “Class not found”; it never displays the extra categories as
supported diagnoses. The source archive is not modified. Training and
evaluation results go to
`trained_model_with_rejection`.

Use Python 3.11 in a virtual environment. On Windows, install the tested
package versions in these steps. TensorFlow.js Python's optional TensorFlow
Decision Forests converter has no Windows wheel; the trainer only converts a
standard Keras model, so it skips that unrelated converter module:

```powershell
$basePython = "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe"
$environment = "$env:LOCALAPPDATA\SkinLesionTraining\venv"
& $basePython -m venv $environment
$python = "$env:LOCALAPPDATA\SkinLesionTraining\venv\Scripts\python.exe"
& $python -m pip install tensorflow==2.15.1 scikit-learn==1.5.2
& $python -m pip install --no-deps tensorflowjs==4.14.0
& $python -m pip install jax==0.4.20 jaxlib==0.4.20 tensorflow-hub==0.16.1 tf-keras==2.15.0 packaging==23.2 importlib_resources
& $python .\train_model.py
```

Python must be installed first if the base path above does not exist. The
virtual environment and packages are kept under your user profile, not in the
website folder. The default data path is `..\..\archive`. Run
`& $python .\train_model.py --help` to change the dataset, output folder,
reference model, batch size, or number of epochs. The training and conversion
are local operations; the reference model is not modified. Review
`trained_model_with_rejection\evaluation.json`, especially precision, recall,
support, and the confusion matrix for every supported class and
`Other / unsupported`. The model is not enabled automatically. Do not set
`available` to `true` just because training completed; first verify that it
performs acceptably for every supported class and rejects unsupported examples
on representative held-out data. The rejection model may still fail on
conditions not represented in training. The app is not validated for clinical
use.

### Quick prototype run

To do a short experiment on CPU, train on at most 200 randomly selected
images per output class for one epoch and evaluate on up to 50 per class:

```powershell
& $python .\train_model.py --epochs 1 --fine-tune-epochs 0 `
  --max-train-images-per-class 200 --max-eval-images-per-class 50
```

This takes a few minutes on the tested Intel i3 laptop. It is only a
smoke-test of the training/export pipeline, not enough training to claim
reliable performance. In the recorded one-epoch test, the internal
`Other / unsupported` class had only 2% recall, so this model is left
unavailable and must not be used for predictions or medical decisions.

The regular full-data run uses a conservative `1e-4` learning rate for the
reference-initialized classifier head and `1e-5` while fine-tuning the last
backbone layers. This is intended to avoid large, abrupt changes to the
reference weights; it still cannot guarantee target outcomes. On a CPU-only
laptop, full-data multi-epoch training may take many hours. A GPU runtime is
recommended for that experiment.

### Full run on a GPU runtime

The local Intel UHD graphics adapter is not supported by this TensorFlow
training setup, so use a Linux GPU notebook runtime such as Colab or Kaggle.
Make this folder layout available in the runtime:

```text
/content/skin-training/
  archive/
    train/
    val/
    test/
  Skin-Lesion-Analyzer-master/
    train_model.py
    final_model_kaggle_version1/
```

Install the tested Python packages from the setup section above, confirm that
TensorFlow detects a GPU, then start the full-data rejection-model run:

```bash
python -c "import tensorflow as tf; print(tf.config.list_physical_devices('GPU'))"
cd /content/skin-training/Skin-Lesion-Analyzer-master
python train_model.py \
  --dataset /content/skin-training/archive \
  --reference-model /content/skin-training/Skin-Lesion-Analyzer-master/final_model_kaggle_version1/model.json \
  --output /content/skin-training/trained_model_with_rejection \
  --batch-size 32 \
  --epochs 15 \
  --fine-tune-epochs 10
```

Do not add the `--max-*-images-per-class` options for the full benchmark.
This run trains seven supported classes plus one internal reject class formed
from the other seven archive categories. After it finishes, inspect
`trained_model_with_rejection/evaluation.json`. Keep `model-info.json` set to
`available: false` unless the complete held-out test results have been
reviewed. Copy the output directory back to persistent storage before the
notebook runtime ends.

### Resume an interrupted GPU run

If a run is interrupted after it has created
`trained_model_with_rejection/best_model.keras`, continue from that checkpoint with
`--resume`. This skips the initial training stage and runs fine-tuning,
held-out evaluation, and browser-model export. A Linux GPU notebook runtime
(for example, Colab or Kaggle) can substantially speed up training. Use
Python 3.11, make the `archive` dataset, reference model folder, training
script, and checkpoint available in the runtime, and install the tested
packages listed above. Confirm TensorFlow sees a GPU before starting.

With the folder layout above, resume from the project folder using:

```bash
python train_model.py \
  --dataset /content/skin-training/archive \
  --reference-model /content/skin-training/Skin-Lesion-Analyzer-master/final_model_kaggle_version1/model.json \
  --output /content/skin-training/trained_model_with_rejection \
  --batch-size 32 \
  --resume
```

If the GPU runs out of memory, reduce `--batch-size` to 16. Copy the completed
`trained_model_with_rejection` directory back to persistent storage before the
notebook runtime ends.

Model scores are not calibrated clinical confidence and must not be used to
guide treatment without qualified clinical review.


<hr>


<b>How to Run This Project</b>

In order the run this project you will need to set up a web address and then upload files to it as you would do when building a website. 

These are the steps:

1. Set up an account with an internet service provider (ISP). I use <a href="https://www.dreamhost.com/r.cgi?2163352">Dreamhost</a> but there are many others you can use depending on your needs and budget.
2. Register a domain name like mywebsite.com. There is an annual cost for this but some ISP’s will give you your first domain for free.
3. You can upload the files to this domain or you could create a sub-domain like: skinproject.mywebsite.com. The good thing about sub-domains is that they can be set up for free, depending on your ISP. This helps if you have many personal web project ideas that you want to implement. On this project, skin.test.woza.work is actually a subdomain of woza.work.
4. Upload the files to the web address you have created. Your ISP will have specific instructions on how to do this. For example, on Dreamhost the HTML file of the main page has to always be named index.html. These are the files and folders from this repo that you should upload to your site:<br>

- `index.html`
- `faq.html`
- `assets` folder
- `css` folder
- `jscript` folder
- `trained_model_7class` folder
- `manifest.webmanifest`
- `service-worker.js`

The app must be served over HTTPS (or from `localhost`) for installation and
offline support. The first online visit caches the app shell and trained
seven-class model locally; allow the model to finish loading before using the
app offline. Browser storage limits and eviction policies vary.

After uploading the files, visit the HTTPS address in a supported browser and
use its install option (the in-app Install button appears when the browser
supports the prompt). The model runs in the browser; images are not uploaded
to a server. Patient data, images, and results are stored on this device only
if the user opts in to local history.

For local development, serve this folder with VS Code Live Server or run
`py -m http.server 8000` from this folder and open `http://localhost:8000`.
Opening `index.html` directly as a file does not enable PWA installation or
offline caching.


The service worker caches the main browser libraries as best effort during
installation. If the TensorFlow.js library is not available to cache, an
online visit is required before the app can run offline.


<hr>

<b>Bugs & Lessons Learned</b>

1. If the model is not loading into your website:<br>
If you uploaded the model using FileZilla then the default transfer setting may need to be changed.<br>
Go to Settings->Transfers->File_Types and set the default transfer type to Binary.<br> 
Then upload the model to the server again.

2. When trouble shooting your website ensure that your browser is in "Incognito" mode. Otherwise it will load the model (and site) that is stored in the cache and you will not be looking at the latest version of the model.

3. Create the model in Keras and convert it to Tensorflow.js without first saving it. If you save it, load a saved model then convert - the model may not work when loaded into your site.

4. A converted tf.keras model does not work when loaded into at the app. A native Keras model must be used. When I say, 'does not work' I mean that either the model will not load into the app or if it loads, it will not output a prediction.

5. Another complication - If you don't use tf.keras then confusion-matrix results may differ from the training and evaluation output. I think there is a problem with predict_generator() in native Keras - or maybe I'm using it wrong.

6. The app does not work in OSX Safari. It's best to use the latest version of Chrome. When developing Tensorflowjs based apps browser support needs to be kept in mind.

7. Some image datasets contain images in TIF format. Web browsers don't support TIF format. Therefore, users will need to submit images in jpg or png format. Therefore, when training the model it's important to convert the training images to jpg or png before using them for training. If you don't do this then you will find the predictions from the app will not match the predictions from the model - the app predictions will be bad.

8. There are slight differences in the predicted probabilities when images are submitted via pc and via mobile phone. This appears to indicate that the mobile browser may be somehow modifying the image before it gets submitted to the model for prediction.

9. From Tensorflow.js version 1.0.0 and beyond it's possible to add a progress bar by using onProgress. The progress bar gives the user a nice visual cue during model download. Also, when a user returns to the app later, a full progress bar tells the user that a cached model is instantly available so he/she won't need to wait for download. The downside is that when a progress bar is added the model download becomes unreliable if the internet connection is slow. In fact model download regularly fails. It could be that I've just implemented the progress bar functionality badly. When there's no progress bar I found that even when the connection was slow the model downloads slowly but successfully. This web app has a progress bar implemented: http://apple.test.woza.work/

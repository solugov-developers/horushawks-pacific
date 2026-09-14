FROM python:3.12-slim
RUN pip install --no-cache-dir requests==2.32.3 boto3==1.35.* psycopg2-binary==2.9.* pillow==11.* numpy==2.*
WORKDIR /app
COPY fetch_images.py /app/fetch_images.py
CMD ["python", "-u", "fetch_images.py"]

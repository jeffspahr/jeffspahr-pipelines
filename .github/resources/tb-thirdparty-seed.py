import boto3,gcsfs,time
s3=boto3.client('s3',endpoint_url='http://127.0.0.1:5000',aws_access_key_id='fixture',aws_secret_access_key='fixture',region_name='us-east-1')
gcs=gcsfs.GCSFileSystem(token='anon',endpoint_url='http://127.0.0.1:4443')
for attempt in range(30):
 try:
  s3.create_bucket(Bucket='tb-probe');gcs.mkdir('tb-probe');break
 except Exception:
  if attempt==29:raise
  time.sleep(2)
body=b'kfp-storage-probe'
s3.put_object(Bucket='tb-probe',Key='logs/probe.txt',Body=body)
gcs.pipe('tb-probe/logs/probe.txt',body)
assert s3.get_object(Bucket='tb-probe',Key='logs/probe.txt')['Body'].read()==body
assert gcs.cat('tb-probe/logs/probe.txt')==body
print('Both fixture clients verified exact seeded object bytes')

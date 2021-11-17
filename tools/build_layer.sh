# Clean up the artifacts if they still exits
rm -rf build/chrome-aws-lambda && rm -rf build/layer.zip

# chrome-aws-lambda provides a layer with many of the dependencies
# for chrome already setup
git clone https://github.com/alixaxel/chrome-aws-lambda.git build/chrome-aws-lambda
cd build/chrome-aws-lambda

# version 8.2.0, chrome 90
git checkout 5201d6bfe62e0606c5f24229a94f04a059ea7b30
# Locks their typescript version, the build breaks with anything after this version
npm install typescript@4.3.2
make ../layer.zip

echo "
DONE BUILDING :D

Take build/layer.zip and create a new layer with it at
https://us-west-1.console.aws.amazon.com/lambda/home?region=us-west-1#/layers
"

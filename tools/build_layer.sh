# Clean up the artifacts if they still exits
rm -rf build/chrome-aws-lambda && rm -rf build/layer.zip

# chrome-aws-lambda provides a layer with many of the dependencies
# for chrome already setup
git clone https://github.com/alixaxel/chrome-aws-lambda.git build/chrome-aws-lambda
cd build/chrome-aws-lambda

# version 2.1.1, chrome 80
git checkout ba8cde3f992fc387ede9b047afee9a4f3eb5ca5c
make ../layer.zip

echo "
DONE BUILDING :D

Take build/layer.zip and create a new layer with it at
https://us-west-1.console.aws.amazon.com/lambda/home?region=us-west-1#/layers
"

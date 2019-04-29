#!/bin/sh

# parse arguments

usage() {
  echo 'Usage: extract_levelshots.sh -i <inputDirectory> -o <outputDirectory>'
  exit
}

if [ "$#" -ne 4 ]
then
  usage
fi

while [ "$1" != "" ]; do
    case $1 in
        -i )           shift
                       INPUT=$1
                       ;;
        -o )           shift
                       OUTPUT=$1
                       ;;
    esac
    shift
done

if [ "$INPUT" = "" ]
then
    usage
fi
if [ "$OUTPUT" = "" ]
then
    usage
fi

# extract all levelshots
for f in $INPUT/*.pk3 ; do
    [ -f "$f" ] || continue
    unzip -o "$f" 'levelshots/*' -d $OUTPUT
done

# convert all tga and png to jpg
for f in $OUTPUT/levelshots/*.tga $OUTPUT/levelshots/**/*.tga $OUTPUT/levelshots/*.png $OUTPUT/levelshots/**/*.png ; do
   [ -f "$f" ] || continue
    echo "Converting $f to JPG"
    convert "$f" "${f%.*}.jpg"
    rm "$f"
done

# resize all JPG files to optimal 184x184 size
for f in $OUTPUT/levelshots/*.jpg $OUTPUT/levelshots/**/*.jpg ; do
   [ -f "$f" ] || continue
    echo "Resizing $f to 184x184"
    convert "$f" -resize 184x184! "$f"

done

# rename everything to lowercase
echo "Renaming all files to lowercase"
find $OUTPUT/levelshots -depth -exec rename 's/(.*)\/([^\/]*)/$1\/\L$2/' {} \;
